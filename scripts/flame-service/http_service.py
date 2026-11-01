"""Bounded private image-inference HTTP transport; no submitted images persisted."""
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler
import io
import json
import secrets
import threading
import warnings
from PIL import Image, ImageFile, ImageOps, UnidentifiedImageError

MAX_BYTES=12*1024*1024
MAX_PIXELS=40_000_000
Image.MAX_IMAGE_PIXELS=MAX_PIXELS
ImageFile.LOAD_TRUNCATED_IMAGES=False

class InputError(ValueError):
    pass

def decode_image(data):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                kind=image.format
                if kind not in {'JPEG','PNG','WEBP'}:raise InputError('Only JPEG, PNG and WebP are supported')
                if getattr(image,'n_frames',1)!=1:raise InputError('Animated images are not supported')
                if min(image.size)<32 or image.width*image.height>MAX_PIXELS:raise InputError('Image geometry is out of range')
                stored_size=list(image.size);orientation=image.getexif().get(274,1);image.load()
                oriented=ImageOps.exif_transpose(image)
                if 'A' in oriented.getbands():
                    background=Image.new('RGBA',oriented.size,'white');background.alpha_composite(oriented.convert('RGBA'));rgb=background.convert('RGB')
                else:rgb=oriented.convert('RGB')
        return rgb,{'format':kind,'stored_size':stored_size,'oriented_size':list(rgb.size),'exif_orientation':orientation,'sha256':hashlib.sha256(data).hexdigest()}
    except InputError:raise
    except (OSError,ValueError,SyntaxError,Image.DecompressionBombError,Image.DecompressionBombWarning,UnidentifiedImageError) as error:
        raise InputError('Image is corrupt, unsupported, or exceeds the pixel limit') from error

class State:
    def __init__(self,engine,token):
        self.engine=engine;self.token=token
        self.inference_lock=threading.Lock();self.upload_slots=threading.BoundedSemaphore(4)

def make_handler(state):
    class Handler(BaseHTTPRequestHandler):
        server_version='FlameService/1.0'
        def setup(self):
            super().setup();self.connection.settimeout(30)
        def log_message(self,fmt,*args):
            print(json.dumps({'event':'http','message':fmt%args}),flush=True)
        def respond(self,status,body):
            data=json.dumps(body,ensure_ascii=False,allow_nan=False).encode()
            self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)))
            self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
            if status==429:self.send_header('Retry-After','1')
            self.end_headers();self.wfile.write(data)
        def authorized(self):
            return hmac.compare_digest(self.headers.get('Authorization','').encode(),('Bearer '+state.token).encode())
        def do_GET(self):
            if self.path in ['/','/health']:
                return self.respond(200,{'status':'ok','ready':True,'provider':'FLAME','model':state.engine.info['model'],'inference_endpoint':'POST /v1/localize','authentication':'Bearer token','localization_supported':True})
            if self.path=='/v1/model':return self.respond(200,state.engine.info) if self.authorized() else self.respond(401,{'error':'unauthorized'})
            self.respond(404,{'error':'not_found'})
        def do_POST(self):
            if self.path!='/v1/localize':return self.respond(404,{'error':'not_found'})
            if not self.authorized():return self.respond(401,{'error':'unauthorized'})
            if self.headers.get('Transfer-Encoding'):return self.respond(400,{'error':'content_length_required'})
            try:size=int(self.headers.get('Content-Length','0'))
            except ValueError:return self.respond(400,{'error':'invalid_content_length'})
            if not 0<size<=MAX_BYTES:return self.respond(413,{'error':'image_size_out_of_range'})
            if not state.upload_slots.acquire(blocking=False):return self.respond(429,{'error':'busy'})
            locked=False
            try:
                data=self.rfile.read(size)
                if len(data)!=size:return self.respond(400,{'error':'incomplete_body'})
                image,metadata=decode_image(data);locked=state.inference_lock.acquire(blocking=False)
                if not locked:return self.respond(429,{'error':'model_busy'})
                result=state.engine.infer(image,metadata);result['request_id']=secrets.token_hex(12)
                return self.respond(200,result)
            except InputError as error:return self.respond(422,{'error':'invalid_image','message':str(error)})
            except (BrokenPipeError,ConnectionResetError,TimeoutError):return
            except Exception as error:
                print(json.dumps({'event':'inference_error','type':type(error).__name__}),flush=True)
                return self.respond(503,{'error':'inference_failed','message':'Model inference failed; retry later'})
            finally:
                if locked:state.inference_lock.release()
                state.upload_slots.release()
    return Handler
