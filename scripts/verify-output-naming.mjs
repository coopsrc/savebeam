// Offline real-yt-dlp check. Usage: node scripts/verify-output-naming.mjs <python-with-yt-dlp>
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { URL } from "node:url";

const python = process.argv[2];
if (!python) throw new Error("Pass a Python interpreter with yt_dlp installed.");
const source = readFileSync(
  new URL("../src-tauri/src/security/download_args.rs", import.meta.url),
  "utf8",
);
const template = (name) => {
  const match = source.match(new RegExp(`const ${name}: &str = "([^"]+)";`));
  if (!match) throw new Error(`Cannot read ${name} from Rust source.`);
  return match[1];
};

const result = execFileSync(
  python,
  [
    "-c",
    String.raw`
import json
import contextlib
import io
from pathlib import Path
import sys
from yt_dlp import YoutubeDL
from yt_dlp.utils import replace_extension, subtitles_filename

single, series = sys.argv[1:]
root = Path('/savebeam-fixture-downloads')
cases = []

def names(template, fields):
    info = {'id': 'BV19wee6BEeP', 'title': '中文视频 标题', 'ext': 'mp4', 'format_id': '30120+30280', **fields}
    with YoutubeDL({'quiet': True, 'no_warnings': True, 'windowsfilenames': True,
                    'paths': {'home': str(root)}, 'outtmpl': {'default': template}}) as ydl:
        media = Path(ydl.prepare_filename(info))
        paths = (media, Path(ydl.prepare_filename(info, 'infojson')),
                 Path(subtitles_filename(str(media), 'zh-Hans', 'vtt', info['ext'])),
                 Path(replace_extension(str(media), 'jpg', info['ext'])))
        assert all(path.is_relative_to(root) for path in paths), paths
        return tuple(str(path.relative_to(root)) for path in paths)

def check(label, template, fields, expected):
    result = names(template, fields)
    assert result[0] == expected, (label, result, expected)
    assert '30120' not in result[0] and '30280' not in result[0], result
    cases.append({'case': label, 'media': result[0]})
    return result

result = check('bilibili', single, {}, '中文视频 标题 [BV19wee6BEeP].mp4')
assert result[1:] == ('中文视频 标题 [BV19wee6BEeP].info.json', '中文视频 标题 [BV19wee6BEeP].zh-Hans.vtt', '中文视频 标题 [BV19wee6BEeP].jpg')
check('single ignores playlist folder', single, {'playlist_title': '课程', 'playlist_id': '123', 'playlist_index': 2}, result[0])
check('youtube', single, {'id': 'BaW_jenozKc'}, '中文视频 标题 [BaW_jenozKc].mp4')
check('bilibili part', single, {'id': 'BV19wee6BEeP_p2'}, '中文视频 标题 [BV19wee6BEeP_p2].mp4')
result = check('playlist', series, {'playlist_title': 'Rust 课程', 'playlist_id': 'list123', 'playlist_index': 2}, 'Rust 课程 [list123]/2-中文视频 标题 [BV19wee6BEeP].mp4')
assert all(path.startswith('Rust 课程 [list123]/2-中文视频 标题 [BV19wee6BEeP].') for path in result)
check('series fallback', series, {'series': '课程', 'series_id': 'ss20', 'episode_number': 7}, '课程 [ss20]/7-中文视频 标题 [BV19wee6BEeP].mp4')
check('playlist ID takes precedence', series, {'playlist_title': '课程', 'playlist_id': '123', 'series_id': 'other'}, '课程 [123]/1-中文视频 标题 [BV19wee6BEeP].mp4')
check('missing group ID', series, {'playlist_title': '课程'}, '课程/1-中文视频 标题 [BV19wee6BEeP].mp4')
check('missing group metadata', series, {}, '未命名系列/1-中文视频 标题 [BV19wee6BEeP].mp4')
check('unknown IDs omitted', series, {'id': None}, '未命名系列/1-中文视频 标题.mp4')
check('MP3 extension', single, {'ext': 'mp3'}, '中文视频 标题 [BV19wee6BEeP].mp3')
assert names(single, {'id': 'first'})[0] != names(single, {'id': 'second'})[0]
unsafe = names(series, {'title': '测试/非法:标题? %(id)s', 'id': '../../video:bad', 'playlist_title': '../课程', 'playlist_id': '../../list:bad'})
for value in unsafe:
    path = Path(value)
    assert len(path.parts) == 2, value
    assert not any(char in path.name for char in chr(58) + chr(92) + '|?*'), value
entries = [{'_type': 'video', 'id': f'video{i}', 'title': f'第{i}课',
            'url': 'https://example.invalid/fixture.mp4', 'ext': 'mp4', 'format_id': 'fixture',
            'vcodec': 'avc1', 'acodec': 'aac', 'extractor': 'fixture', 'extractor_key': 'Generic',
            'webpage_url': 'https://example.invalid/video'} for i in range(1, 6)]
captured = io.StringIO()
with contextlib.redirect_stdout(captured), YoutubeDL({
        'quiet': True, 'no_warnings': True, 'simulate': True, 'check_formats': False,
        'playlist_items': '1,3,5', 'outtmpl': series,
        'forceprint': {'video': ['SB:%(playlist_index)d:%(id)s:%(filename)s']}}) as ydl:
    ydl.process_ie_result({'_type': 'playlist', 'id': 'list123', 'title': '课程',
                          'extractor': 'fixture', 'extractor_key': 'Generic',
                          'webpage_url': 'https://example.invalid/playlist', 'entries': entries}, download=True)
selected = [line for line in captured.getvalue().splitlines() if line.startswith('SB:')]
assert [line.split(':')[1] for line in selected] == ['1', '3', '5'], selected
assert all(f'{i}-第{i}课 [video{i}].mp4' in line for i, line in zip([1,3,5], selected)), selected
print(json.dumps({'cases': cases, 'unsafe_fields_sanitized': list(unsafe),
                  'native_playlist_selection': selected}, ensure_ascii=False, indent=2))
`,
    template("SINGLE_OUTPUT_TEMPLATE"),
    template("SERIES_OUTPUT_TEMPLATE"),
  ],
  { encoding: "utf8" },
);
process.stdout.write(result);
