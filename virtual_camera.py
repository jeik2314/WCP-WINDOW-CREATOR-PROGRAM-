"""Send the newest WCP composition to an installed OBS Virtual Camera."""
import io
import sys
import time
import threading
import urllib.request


def main():
    import numpy as np
    from PIL import Image
    import pyvirtualcam

    def read_frame():
        with urllib.request.urlopen('http://127.0.0.1:47831/api/frame', timeout=.4) as response:
            data = response.read()
            stamp = float(response.headers.get('X-WCP-Capture-Time', '0')) / 1000
            revision = response.headers.get('X-WCP-Frame-Id')
        return data, stamp, revision

    print('Open WINDOW CREATOR PROGRAM, select Camera / OBS. Ctrl+C to stop.')
    first = None
    while first is None:
        try:
            data, stamp, _ = read_frame()
            if data and time.time() - stamp < .4:
                first = Image.open(io.BytesIO(data)).convert('RGBA')
        except OSError:
            pass
        if first is None:
            time.sleep(.05)
    width, height = first.size
    width += width % 2
    height += height % 2
    lock, stopped = threading.Lock(), threading.Event()
    latest = [None, 0.0]

    def prepare(image):
        if image.size != (width, height):
            image.thumbnail((width, height), Image.Resampling.BILINEAR)
        rgb = Image.new('RGB', (width, height), 'black')
        rgb.paste(image, ((width-image.width)//2, (height-image.height)//2), image)
        return np.ascontiguousarray(np.asarray(rgb))

    latest[:] = [prepare(first), time.monotonic()]

    def receive_latest():
        previous = None
        while not stopped.is_set():
            begin = time.monotonic()
            try:
                data, stamp, revision = read_frame()
                if data and revision != previous and time.time() - stamp < .4:
                    image = Image.open(io.BytesIO(data)).convert('RGBA')
                    pixels = prepare(image)
                    with lock:
                        latest[:] = [pixels, time.monotonic() - max(0, time.time() - stamp)]
                    previous = revision
            except (OSError, ValueError):
                pass
            stopped.wait(max(0, 1/60 - (time.monotonic() - begin)))

    worker = threading.Thread(target=receive_latest, daemon=True)
    worker.start()
    blank = np.zeros((height, width, 3), dtype=np.uint8)
    try:
        with pyvirtualcam.Camera(width=width, height=height, fps=60, backend='obs') as camera:
            print('Virtual camera:', camera.device, width, height, '60 fps; latest frame only')
            while True:
                with lock:
                    pixels, received = latest
                camera.send(pixels if time.monotonic() - received < .4 else blank)
                camera.sleep_until_next_frame()
    finally:
        stopped.set()
        worker.join(timeout=.6)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        print('Virtual camera could not start:', exc)
        print('Install OBS Studio and dependencies using SetupVirtualCamera.cmd.')
        sys.exit(1)
