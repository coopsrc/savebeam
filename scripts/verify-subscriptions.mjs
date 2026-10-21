// Offline verification against real yt-dlp: no network requests or media writes.
// node scripts/verify-subscriptions.mjs <python-with-yt-dlp>
import { execFileSync } from "node:child_process";
import process from "node:process";
if (!process.argv[2]) throw new Error("Pass Python with yt_dlp installed.");
process.stdout.write(
  execFileSync(
    process.argv[2],
    [
      "-c",
      String.raw`
import contextlib, io, json, tempfile
from pathlib import Path
from yt_dlp import YoutubeDL
from yt_dlp.utils import match_filter_func

def guard(identity):
    encoded = ''.join('\\U%08x' % ord(ch) for ch in identity)
    return "id ~= '^%s$'" % encoded

for identity in ['video72', "quote' & id=bad", '中文😀.[]']:
    match = match_filter_func([guard(identity)])
    assert match({'id': identity}, incomplete=False) is None, identity
    assert match({'id': identity + 'other'}, incomplete=False) is not None, identity

def run(identity, target='video72'):
    entries = [{'_type':'video', 'id': f'video{i}', 'title':f'Lesson {i}',
                'url':'https://example.invalid/fixture.mp4', 'ext':'mp4',
                'format_id':'fixture', 'vcodec':'avc1', 'acodec':'aac',
                'extractor':'fixture', 'extractor_key':'Generic',
                'webpage_url':f'https://example.invalid/video{i}'} for i in range(1,81)]
    entries[71]['id'] = target
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured), YoutubeDL({
            'quiet':True, 'no_warnings':True, 'simulate':True, 'check_formats':False,
            'playlist_items':'72', 'match_filter':match_filter_func([guard(identity)]),
            'forceprint':{'video':['SB:%(playlist_index)d:%(id)s']}}) as ydl:
        ydl.process_ie_result({'_type':'playlist', 'id':'series', 'title':'Course',
                              'extractor':'fixture', 'extractor_key':'Generic',
                              'webpage_url':'https://example.invalid/list', 'entries':entries}, download=True)
    return [line for line in captured.getvalue().splitlines() if line.startswith('SB:')]

assert run('video72') == ['SB:72:video72']
assert run('video72', 'reordered-wrong-video') == []

# Real transport and after_move records, using only an isolated local fixture file.
# file URLs are enabled solely in this test process, never in Savebeam's argument builder.
with tempfile.TemporaryDirectory(prefix='savebeam-sub-native-') as temporary:
    root = Path(temporary)
    source = root / 'source.bin'
    source.write_bytes(b'savebeam fixture bytes')
    info = {'id':'video72', 'title':'Lesson', 'url':source.as_uri(), 'ext':'mp4',
            'format_id':'fixture', 'vcodec':'avc1', 'acodec':'aac', 'extractor':'fixture',
            'extractor_key':'Generic', 'playlist_index':72, 'playlist_title':'Course', 'playlist_id':'list'}
    for attempt in range(2):
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured), YoutubeDL({
                'quiet':True, 'no_warnings':True, 'enable_file_urls':True, 'overwrites':False,
                'playlist_items':'72',
                'match_filter':match_filter_func([guard('video72')]),
                'outtmpl': str(root / 'downloads' / '%(playlist_title)s [%(playlist_id)s]/%(playlist_index)d-%(title)s [%(id)s].%(ext)s'),
                'forceprint': {'after_move': ['SB_MEDIA:{"id":%(id)j,"path":%(filepath)j}']}}) as ydl:
            ydl.process_ie_result({'_type':'playlist', 'id':'list', 'title':'Course',
                                  'extractor':'fixture', 'extractor_key':'Generic',
                                  'entries':[dict(info, id=f'video{i}') for i in range(1,81)]}, download=True)
        records = [json.loads(line.removeprefix('SB_MEDIA:')) for line in captured.getvalue().splitlines() if line.startswith('SB_MEDIA:')]
        assert len(records) == 1 and records[0]['id'] == 'video72', records
        final = Path(records[0]['path'])
        assert final.read_bytes() == source.read_bytes()
        assert final.name == '72-Lesson [video72].mp4', final
print(json.dumps({'native_selection_past_fifty':'72:video72', 'reordered_wrong_id':'rejected',
                  'quoted_unicode_filter_ids':'passed', 'after_move_identity_and_skip_existing':'passed'}, ensure_ascii=False))
`,
    ],
    { encoding: "utf8" },
  ),
);
