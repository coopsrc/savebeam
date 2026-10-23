// Offline: actual installed yt-dlp downloads only a local HTTP fixture into a temp directory.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { URL } from "node:url";
if (!process.argv[2]) throw new Error("Pass a Python interpreter with yt_dlp installed.");
const source = readFileSync(
  new URL("../src-tauri/src/security/download_args.rs", import.meta.url),
  "utf8",
);
const projection = source.match(/concat!\(("after_move:SB_SOURCE:[\s\S]*?)\)\s*\.into\(\)/)?.[1];
if (!projection) throw new Error("Source template not found");
const template = [...projection.matchAll(/"(?:[^"\\]|\\.)*"/g)]
  .map((match) => JSON.parse(match[0]))
  .join("")
  .replace(/^after_move:/, "");
process.stdout.write(
  execFileSync(
    process.argv[2],
    [
      "-c",
      String.raw`
import contextlib, http.server, io, json, pathlib, sys, tempfile, threading
from yt_dlp import YoutubeDL
template = sys.argv[1]
payload = b'local fixture media bytes, not a real remote video'
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload)
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1',0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
try:
    with tempfile.TemporaryDirectory(prefix='savebeam-source-projection-') as directory:
        url = f'http://127.0.0.1:{server.server_port}/fixture.mp4?token=SECRET_SIGNED_URL'
        formats = [{'format_id':str(i), 'ext':'mp4', 'vcodec':'avc1.640033', 'acodec':'mp4a.40.2',
                    'width':1920, 'height':1080, 'fps':30, 'filesize':len(payload), 'url':url} for i in range(500)]
        info = {'id':'BVfixture', 'title':'local fixture', 'extractor':'fixture', 'extractor_key':'Generic',
                'duration':123.5, 'modified_timestamp':1000000, 'cid':42, 'formats':formats,
                'webpage_url':url, 'http_headers':{'X-Fixture':'SECRET_HEADER'}}
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured), YoutubeDL({'quiet':True,'no_warnings':True,'noprogress':True,
                'format':'499', 'check_formats':False, 'outtmpl':str(pathlib.Path(directory)/'%(title)s.%(ext)s'),
                'forceprint':{'after_move':['SB_MEDIA:{"id":%(id)j,"path":%(filepath)j}', template]}}) as ydl:
            ydl.process_ie_result(info, download=True)
        lines = captured.getvalue().splitlines()
        media = json.loads(next(line.split(':',1)[1] for line in lines if line.startswith('SB_MEDIA:')))
        source_line = next(line for line in lines if line.startswith('SB_SOURCE:'))
        projected = json.loads(source_line.split(':',1)[1]); observation = projected['source']
        assert projected['id'] == observation['id'] == media['id'] == 'BVfixture'
        assert pathlib.Path(media['path']).read_bytes() == payload
        assert projected['path'] == media['path']
        assert observation['cid'] == 42 and observation['duration'] == 123.5 and observation['modified_timestamp'] == 1000000
        assert len(observation['formats']) == 500
        assert all(set(f) <= {'format_id','ext','vcodec','acodec','width','height','fps','filesize'} for f in observation['formats'])
        assert 'SECRET' not in source_line and 'http_headers' not in source_line and 'url' not in source_line
        assert 16*1024 < len(source_line.encode()) < 128*1024
        with YoutubeDL({'quiet':True}) as ydl:
            missing = json.loads(ydl.evaluate_outtmpl(template, {'id':'v','filepath':'/local/file'}).split(':',1)[1])
        assert missing['source']['formats'] == []
        print(json.dumps({'verified':'real yt-dlp after_move; local HTTP only', 'formats':500, 'sourceBytes':len(source_line.encode()), 'identityIndependent':True, 'missingFieldsSafe':True}))
finally:
    server.shutdown(); server.server_close(); thread.join()
`,
      template,
    ],
    { encoding: "utf8" },
  ),
);
