'use strict';
// Translate UI text nodes only. User content lives in inputs/canvas and is never traversed.
const WcpI18n=(()=>{
 const supported=['ru','en','uk'],texts=new Map(),attributes=new Map();let dictionary={},patterns=[],locale='ru',observer;
 try{const saved=localStorage.getItem('wcp-language-v1');if(supported.includes(saved))locale=saved}catch{}
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 function t(source,params,depth=0){
  source=String(source??'');if(depth>3)return source;
  let key=source,args=params||{};
  if(!dictionary[key])for(const p of patterns){const match=p.regex.exec(source);if(match){key=p.key;args=Object.fromEntries(p.names.map((name,i)=>[name,match[i+1]]));break}}
  let value=locale==='ru'?key:dictionary[key]?.[locale]||key;
  return value.replace(/\{(\w+)\}/g,(whole,name)=>name in args?(name==='error'?t(args[name],undefined,depth+1):String(args[name])):whole);
 }
 function excluded(node){return node.parentElement?.closest('script,style,textarea,canvas,[data-no-i18n]')}
 function text(node,force=false){
  if(excluded(node))return;let binding=texts.get(node);const raw=node.nodeValue;
  if(binding&&raw===binding.last){if(!force)return}else{if(!/[А-Яа-яЁё]/.test(raw)&&!dictionary[raw.trim()])return;binding={source:raw,last:raw};texts.set(node,binding)}
  const original=binding.source,trimmed=original.trim(),prefix=original.slice(0,original.indexOf(trimmed)),suffix=original.slice(original.indexOf(trimmed)+trimmed.length);
  const output=prefix+t(trimmed)+suffix;binding.last=output;if(node.nodeValue!==output)node.nodeValue=output;
 }
 function attr(node,name,force=false){
  if(node.closest('[data-no-i18n]'))return;const raw=node.getAttribute(name);if(raw===null)return;let entry=attributes.get(node);if(!entry){entry={};attributes.set(node,entry)}let binding=entry[name];
  if(binding&&raw===binding.last){if(!force)return}else{if(!/[А-Яа-яЁё]/.test(raw))return;binding=entry[name]={source:raw,last:raw}}
  const output=t(binding.source);binding.last=output;if(raw!==output)node.setAttribute(name,output);
 }
 function scan(root){
  if(root.nodeType===Node.TEXT_NODE){text(root);return}if(root.nodeType!==Node.ELEMENT_NODE)return;
  if(root.matches('script,style,textarea,canvas,[data-no-i18n]'))return;
  for(const name of ['aria-label','title'])attr(root,name);
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))text(node);
  root.querySelectorAll('[aria-label],[title]').forEach(el=>{attr(el,'aria-label');attr(el,'title')});
 }
 function prune(){if(texts.size>250)for(const node of texts.keys())if(!node.isConnected)texts.delete(node);if(attributes.size>200)for(const node of attributes.keys())if(!node.isConnected)attributes.delete(node)}
 function apply(){
  document.documentElement.lang=locale;
  for(const node of texts.keys())if(node.isConnected)text(node,true);
  for(const [node,entry]of attributes)if(node.isConnected)for(const name of Object.keys(entry))attr(node,name,true);
  const selector=document.getElementById('language');if(selector)selector.value=locale;
  window.dispatchEvent(new CustomEvent('wcp-languagechange',{detail:{locale}}));
  fetch('/api/language',{method:'POST',headers:{'X-WCP':'1'},body:locale}).catch(()=>{});
 }
 function setLocale(next){if(!supported.includes(next))return;locale=next;try{localStorage.setItem('wcp-language-v1',locale)}catch{}apply()}
 const ready=(async()=>{
  try{const response=await fetch('locales.json');if(!response.ok)throw new Error('Language file is unavailable');dictionary=await response.json();
   patterns=Object.keys(dictionary).filter(key=>/\{\w+\}/.test(key)).map(key=>{const names=[];let cursor=0,regex='^';for(const match of key.matchAll(/\{(\w+)\}/g)){regex+=escape(key.slice(cursor,match.index))+'([\\s\\S]+?)';names.push(match[1]);cursor=match.index+match[0].length}regex+=escape(key.slice(cursor))+'$';return {key,names,regex:new RegExp(regex)}});
  }catch(e){locale='ru';console.error(e)}
  scan(document.body);
  observer=new MutationObserver(changes=>{for(const change of changes){if(change.type==='characterData')text(change.target);else if(change.type==='attributes')attr(change.target,change.attributeName);else change.addedNodes.forEach(scan)}prune()});
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','title']});
  document.getElementById('language').addEventListener('change',e=>setLocale(e.target.value));apply();
 })();
 return {t,setLocale,ready,get locale(){return locale},get keys(){return Object.keys(dictionary)}};
})();
function tr(source,params){return WcpI18n.t(source,params)}
