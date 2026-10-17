using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Text;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Net.Sockets;
using System.Collections.Specialized;
using System.Security.Cryptography;

[assembly: System.Reflection.AssemblyVersion("1.3.1.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.3.1.0")]

// Loopback TCP keeps the portable launcher independent of administrator URL reservations.
class TinyRequest {
 public string HttpMethod; public Uri Url; public NameValueCollection Headers=new NameValueCollection(); public Stream InputStream;
}
class TinyResponse {
 public string ContentType="text/plain";public long ContentLength64;public int StatusCode=200;public NameValueCollection Headers=new NameValueCollection();public MemoryStream OutputStream=new MemoryStream();TcpClient client;
 public TinyResponse(TcpClient c){client=c;}
 public void Close(){try{byte[] data=OutputStream.ToArray();var header=new StringBuilder("HTTP/1.1 "+StatusCode+" "+(StatusCode==200?"OK":StatusCode==204?"No Content":"Error")+"\r\nContent-Type: "+ContentType+"\r\nContent-Length: "+data.Length+"\r\nConnection: close\r\n");foreach(string k in Headers)header.Append(k+": "+Headers[k]+"\r\n");header.Append("\r\n");byte[] h=Encoding.ASCII.GetBytes(header.ToString());var stream=client.GetStream();stream.Write(h,0,h.Length);stream.Write(data,0,data.Length);}catch{}finally{OutputStream.Dispose();client.Close();}}
}
class TinyContext {
 public TinyRequest Request;public TinyResponse Response;public TcpClient Client;public bool Upgraded;
 public TinyContext(TcpClient client){Client=client;client.NoDelay=true;Response=new TinyResponse(client);client.ReceiveTimeout=10000;client.SendTimeout=10000;var stream=client.GetStream();var head=new MemoryStream();int prev=0,tail=0,b;while((b=stream.ReadByte())>=0){head.WriteByte((byte)b);tail=(tail<<8)|b;if(tail==0x0d0a0d0a)break;if(++prev>32768)throw new Exception("HTTP headers too large");}string[] lines=Encoding.ASCII.GetString(head.ToArray()).Split(new[]{"\r\n"},StringSplitOptions.None);string[] first=lines[0].Split(' ');if(first.Length<2)throw new Exception("Bad HTTP request");Request=new TinyRequest{HttpMethod=first[0],Url=new Uri("http://127.0.0.1:47831"+first[1])};foreach(string line in lines){int colon=line.IndexOf(':');if(colon>0)Request.Headers[line.Substring(0,colon).Trim()]=line.Substring(colon+1).Trim();}int length=0;if(Request.Headers["Transfer-Encoding"]!=null)throw new Exception("Chunked requests are unsupported");if(Request.Headers["Content-Length"]!=null&&!int.TryParse(Request.Headers["Content-Length"],out length))throw new Exception("Bad content length");if(length<0||length>80*1024*1024)throw new Exception("Request too large");var body=new MemoryStream();byte[] buffer=new byte[8192];while(length>0){int n=stream.Read(buffer,0,Math.Min(length,buffer.Length));if(n==0)throw new Exception("Incomplete request");body.Write(buffer,0,n);length-=n;}body.Position=0;Request.InputStream=body;}
}
// RFC 6455 binary transport. Each peer has bounded writes; no outgoing frame queue is kept.
class FrameSocket : IDisposable {
 TcpClient client;NetworkStream wire;object writeGate=new object();public volatile bool Closed;
 public FrameSocket(TinyContext c){client=c.Client;wire=client.GetStream();string key=c.Request.Headers["Sec-WebSocket-Key"];byte[] decoded=Convert.FromBase64String(key);if(decoded.Length!=16||c.Request.Headers["Sec-WebSocket-Version"]!="13")throw new Exception("Invalid WebSocket handshake");string accept;using(var sha=SHA1.Create())accept=Convert.ToBase64String(sha.ComputeHash(Encoding.ASCII.GetBytes(key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));byte[] h=Encoding.ASCII.GetBytes("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "+accept+"\r\n\r\n");wire.Write(h,0,h.Length);c.Upgraded=true;client.NoDelay=true;client.SendTimeout=500;client.ReceiveTimeout=0;client.SendBufferSize=65536;}
 byte[] ReadExact(int count){var bytes=new byte[count];int offset=0;while(offset<count){int n=wire.Read(bytes,offset,count-offset);if(n==0)throw new EndOfStreamException();offset+=n;}return bytes;}
 public byte[] Receive(){using(var assembled=new MemoryStream()){bool fragmented=false;for(;;){byte[] head=ReadExact(2);int op=head[0]&15;bool fin=(head[0]&128)!=0;if((head[0]&112)!=0||(head[1]&128)==0)throw new Exception("Invalid client frame");ulong length=(ulong)(head[1]&127);if(length==126){byte[] b=ReadExact(2);length=(ulong)((b[0]<<8)|b[1]);}else if(length==127){byte[] b=ReadExact(8);length=0;foreach(byte v in b)length=(length<<8)|v;}if(length>32*1024*1024||assembled.Length+(long)length>32*1024*1024)throw new Exception("Frame too large");if(op>=8&&(!fin||length>125))throw new Exception("Invalid control frame");byte[] mask=ReadExact(4),payload=ReadExact((int)length);for(int i=0;i<payload.Length;i++)payload[i]^=mask[i%4];if(op==8){Send(payload,8);Closed=true;return null;}if(op==9){Send(payload,10);continue;}if(op==10)continue;if(op==2&&!fragmented)fragmented=true;else if(op!=0||!fragmented)throw new Exception("Expected binary frame");assembled.Write(payload,0,payload.Length);if(fin)return assembled.ToArray();}}}
 public void Send(byte[] bytes,int opcode=2){lock(writeGate){if(Closed)return;using(var header=new MemoryStream()){header.WriteByte((byte)(128|opcode));if(bytes.Length<126)header.WriteByte((byte)bytes.Length);else if(bytes.Length<=65535){header.WriteByte(126);header.WriteByte((byte)(bytes.Length>>8));header.WriteByte((byte)bytes.Length);}else{header.WriteByte(127);ulong n=(ulong)bytes.Length;for(int i=7;i>=0;i--)header.WriteByte((byte)(n>>(8*i)));}byte[] h=header.ToArray();wire.Write(h,0,h.Length);wire.Write(bytes,0,bytes.Length);}}}
 public void Dispose(){Closed=true;client.Close();}
}
class TinyServer {
 TcpListener listener;public volatile bool IsListening;
 public void Start(){listener=new TcpListener(IPAddress.Loopback,47831);listener.Start();IsListening=true;}
 public TcpClient Accept(){return listener.AcceptTcpClient();}
 public void Stop(){IsListening=false;listener.Stop();}
}

class Program {
 static string root=AppDomain.CurrentDomain.BaseDirectory;
 static string pictures=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),"WINDOW CREATOR PROGRAM");
 static byte[] frame=new byte[0]; static DateTime frameTime=DateTime.MinValue;static long captureTime=0,frameRevision=0;static int subscribers=0; static object gate=new object(); static TinyServer server;
 static JavaScriptSerializer json=new JavaScriptSerializer(); const string url="http://127.0.0.1:47831/";
 static string language="ru";static ContextMenuStrip nativeMenu;static Control uiDispatcher;
 static void ApplyMenuLanguage(){string[] labels=language=="en"?new[]{"Open application","Open PNG folder","Exit"}:language=="uk"?new[]{"Відкрити програму","Відкрити папку PNG","Вихід"}:new[]{"Открыть программу","Открыть папку PNG","Выход"};if(nativeMenu!=null)for(int i=0;i<3;i++)nativeMenu.Items[i].Text=labels[i];}
 [STAThread] static void Main(string[] args) {
  ThreadPool.SetMinThreads(32,32);bool fresh; var mutex=new Mutex(true,"Local\\WindowCreatorProgram47831",out fresh);
  if(!fresh){Launch();return;}
  try {Directory.CreateDirectory(pictures);server=new TinyServer();server.Start();}
  catch(Exception ex){MessageBox.Show(ex.Message,"WINDOW CREATOR PROGRAM");return;}
  ThreadPool.QueueUserWorkItem(delegate {while(server.IsListening){try{var client=server.Accept();ThreadPool.QueueUserWorkItem(delegate {try{Handle(new TinyContext(client));}catch{client.Close();}});}catch{break;}}});
  Application.EnableVisualStyles();
  var tray=new NotifyIcon {Icon=SystemIcons.Application,Visible=true,Text="WINDOW CREATOR PROGRAM"};
  var menu=new ContextMenuStrip();menu.Items.Add("Открыть программу",null,delegate{Launch();});
  menu.Items.Add("Открыть папку PNG",null,delegate{Process.Start("explorer.exe",pictures);});
  menu.Items.Add("Выход",null,delegate{Application.Exit();});tray.ContextMenuStrip=menu;tray.DoubleClick+=delegate{Launch();};
  nativeMenu=menu;uiDispatcher=new Control();uiDispatcher.CreateControl();ApplyMenuLanguage();
  if(Array.IndexOf(args,"--server-only")<0) Launch();
  Application.Run();tray.Dispose();uiDispatcher.Dispose();server.Stop();GC.KeepAlive(mutex);
 }
 static void Launch(){
  string[] browsers={Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Microsoft\\Edge\\Application\\msedge.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Microsoft\\Edge\\Application\\msedge.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google\\Chrome\\Application\\chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Microsoft\\Edge\\Application\\msedge.exe")};
  foreach(var b in browsers)if(File.Exists(b)){Process.Start(b,"--app="+url+" --window-size=1440,960 --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows");return;}Process.Start(url);
 }
 static void Reply(TinyContext c,byte[] bytes,string type){c.Response.ContentType=type;c.Response.ContentLength64=bytes.Length;c.Response.OutputStream.Write(bytes,0,bytes.Length);}
 static void Json(TinyContext c,object obj){Reply(c,Encoding.UTF8.GetBytes(json.Serialize(obj)),"application/json; charset=utf-8");}
 static byte[] Read(TinyRequest r,int max){using(var m=new MemoryStream()){var b=new byte[8192];int n;while((n=r.InputStream.Read(b,0,b.Length))>0){if(m.Length+n>max)throw new Exception("Слишком большой файл");m.Write(b,0,n);}return m.ToArray();}}
 static long NowMs(){return (long)(DateTime.UtcNow-new DateTime(1970,1,1)).TotalMilliseconds;}
 static void SetFrame(byte[] bytes,long captured){long now=NowMs();if(bytes.Length>0&&(now-captured>400||captured>now+1000))return;lock(gate){if(bytes.Length>0&&captured<captureTime)return;frame=bytes;captureTime=captured;frameTime=DateTime.UtcNow;frameRevision++;Monitor.PulseAll(gate);}}
 static void StreamFrames(TinyContext c){
  if(c.Request.Headers["Origin"]!=url.TrimEnd('/')||!String.Equals(c.Request.Headers["Upgrade"],"websocket",StringComparison.OrdinalIgnoreCase)){c.Response.StatusCode=403;return;}
  bool publish=c.Request.Url.Query=="?role=publish";if(!publish&&Interlocked.Increment(ref subscribers)>16){Interlocked.Decrement(ref subscribers);c.Response.StatusCode=503;return;}
  try{using(var peer=new FrameSocket(c)){
   if(publish){for(;;){byte[] packet=peer.Receive();if(packet==null)break;if(packet.Length<8)throw new Exception("Missing capture timestamp");double rawStamp=BitConverter.ToDouble(packet,0);if(double.IsNaN(rawStamp)||double.IsInfinity(rawStamp)||rawStamp<0||rawStamp>1e15)throw new Exception("Invalid timestamp");long stamp=(long)rawStamp;var bytes=new byte[packet.Length-8];Buffer.BlockCopy(packet,8,bytes,0,bytes.Length);if(bytes.Length>0&&(bytes.Length<8||bytes[0]!=137||bytes[1]!=80||bytes[2]!=78||bytes[3]!=71))throw new Exception("Expected PNG");SetFrame(bytes,stamp);peer.Send(BitConverter.GetBytes((double)stamp));}}
   else{ThreadPool.QueueUserWorkItem(delegate{try{while(peer.Receive()!=null){}}catch{}finally{peer.Closed=true;lock(gate)Monitor.PulseAll(gate);}});long seen=-1;bool cleared=false;while(!peer.Closed&&server.IsListening){byte[] bytes;long stamp,revision;bool stale;lock(gate){if(frameRevision==seen)Monitor.Wait(gate,200);revision=frameRevision;stale=(DateTime.UtcNow-frameTime).TotalMilliseconds>750;bytes=stale?new byte[0]:frame;stamp=captureTime;}if(peer.Closed)break;if(revision==seen&&(!stale||cleared))continue;seen=revision;cleared=stale||bytes.Length==0;byte[] packet=new byte[8+bytes.Length];Buffer.BlockCopy(BitConverter.GetBytes((double)stamp),0,packet,0,8);Buffer.BlockCopy(bytes,0,packet,8,bytes.Length);peer.Send(packet);}}
  }}finally{if(!publish)Interlocked.Decrement(ref subscribers);}
 }
 static void Handle(TinyContext c){try{
  c.Response.Headers["Cache-Control"]="no-store"; c.Response.Headers["X-Content-Type-Options"]="nosniff";
  string p=c.Request.Url.AbsolutePath;
  if(p=="/stream"){StreamFrames(c);return;}
  if(c.Request.HttpMethod=="POST"){
   if(c.Request.Headers["X-WCP"]!="1" || (c.Request.Headers["Origin"]!=null && c.Request.Headers["Origin"]!=url.TrimEnd('/'))){c.Response.StatusCode=403;return;}
   if(p=="/api/language"){string next=Encoding.UTF8.GetString(Read(c.Request,16)).Trim();if(next!="ru"&&next!="en"&&next!="uk")throw new Exception("Unsupported language");language=next;if(uiDispatcher!=null&&!uiDispatcher.IsDisposed)uiDispatcher.BeginInvoke(new Action(ApplyMenuLanguage));Json(c,new {language=language});return;}
   if(p=="/api/save"){
    byte[] bytes=Read(c.Request,40*1024*1024);
    using(var ms=new MemoryStream(bytes))using(var img=Image.FromStream(ms)){if(img.Width>4096||img.Height>4096)throw new Exception("Максимум 4096 × 4096");if(img.RawFormat.Guid!=System.Drawing.Imaging.ImageFormat.Png.Guid)throw new Exception("Ожидается PNG");}
    string path=Path.Combine(pictures,"Window_"+DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss_fff")+"_"+Guid.NewGuid().ToString("N").Substring(0,6)+".png");File.WriteAllBytes(path,bytes);Json(c,new {path=path});return;
   }
   if(p=="/api/frame"){byte[] bytes=Read(c.Request,32*1024*1024);long stamp;if(!long.TryParse(c.Request.Headers["X-WCP-Capture-Time"],out stamp))stamp=NowMs();SetFrame(bytes,stamp);Json(c,new {ok=true});return;}
   if(p=="/api/folder"){Process.Start("explorer.exe",pictures);Json(c,new {ok=true});return;}
  }
  if(c.Request.HttpMethod!="GET"){c.Response.StatusCode=405;return;}
  if(p=="/api/info"){var names=new System.Collections.Generic.List<string>();using(var fonts=new InstalledFontCollection())foreach(var f in fonts.Families)names.Add(f.Name);names.Sort();Json(c,new {folder=pictures,fonts=names,language=language,version="1.3.1"});return;}
  if(p=="/api/frame"){byte[] bytes;long stamp,revision;lock(gate){bytes=(DateTime.UtcNow-frameTime).TotalMilliseconds>750?new byte[0]:frame;stamp=captureTime;revision=frameRevision;}c.Response.Headers["X-WCP-Capture-Time"]=stamp.ToString();c.Response.Headers["X-WCP-Frame-Id"]=revision.ToString();if(bytes.Length==0){c.Response.StatusCode=204;return;}Reply(c,bytes,"image/png");return;}
  string file=p=="/"?"index.html":p.TrimStart('/');string path2=Path.GetFullPath(Path.Combine(root,"app",file));
  if(!path2.StartsWith(Path.Combine(root,"app")+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||!File.Exists(path2)){c.Response.StatusCode=404;return;}
  string ext=Path.GetExtension(path2);Reply(c,File.ReadAllBytes(path2),ext==".html"?"text/html; charset=utf-8":ext==".js"?"text/javascript; charset=utf-8":ext==".css"?"text/css; charset=utf-8":ext==".json"?"application/json; charset=utf-8":ext==".ttf"?"font/ttf":"application/octet-stream");
 }catch(Exception ex){c.Response.StatusCode=400;if(!c.Upgraded)try{Json(c,new {error=ex.Message});}catch{}}finally{c.Request.InputStream.Dispose();if(c.Upgraded)c.Client.Close();else c.Response.Close();}}
}
