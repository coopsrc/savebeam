// Real yt-dlp, entirely offline: names/metadata only; no media network requests or downloads.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import process from "node:process";

const source = readFileSync(
  new URL("../src-tauri/src/services/playlist_parts.rs", import.meta.url),
  "utf8",
);
const template = source
  .match(/"(%\(playlist_title\)s[^"\n]+)"/)[1]
  .replace("/{}-P{}-", "/13-P2-")
  .replaceAll("{{}}", "{}");
const result = JSON.parse(
  execFileSync(
    process.argv[2],
    [
      "-c",
      String.raw`
import json, sys, re
from pathlib import Path
from yt_dlp import YoutubeDL
from yt_dlp.postprocessor.metadataparser import MetadataParserPP
from yt_dlp.utils import replace_extension, subtitles_filename

template = sys.argv[1]
root = Path('/savebeam-fixture')
cases = []
for title in ['合集·1973年 "恶魔 Z" 修复合集', '../%(title)s/collection\\1\n中文']:
    info = {'id':'BV1uVy7BCErV_p2', 'title':'避震特别篇 p02 纯享版', 'ext':'mp4', 'playlist_title':'原始分P视频', 'playlist_id':'BV1uVy7BCErV', 'playlist_index':2}
    with YoutubeDL({'quiet':True, 'no_warnings':True, 'windowsfilenames':True, 'paths':{'home':str(root)}, 'outtmpl':{'default':template}}) as ydl:
        # Same fixed replacement args as Rust naming_args. Backslashes are literal, not regex groups.
        pp = MetadataParserPP(ydl, [(MetadataParserPP.Actions.REPLACE, 'playlist_title', r'\A[\s\S]*\Z', title.replace('\\', '\\\\')), (MetadataParserPP.Actions.REPLACE, 'playlist_id', r'\A[\s\S]*\Z', '306979414_6546672')])
        _, changed = pp.run(info)
        final = Path(ydl.prepare_filename(changed))
        assert final.is_relative_to(root), final
        assert final.name == '13-P2-避震特别篇 p02 纯享版 [BV1uVy7BCErV_p2].mp4', final
        common = Path(ydl.prepare_filename({**info,'playlist_title':title,'playlist_id':'306979414_6546672'}, outtmpl='%(playlist_title)s%(playlist_id& [{}]|)s/%(playlist_index)d-%(title)s%(id& [{}]|)s.%(ext)s'))
        assert final.parent == common.parent, (final, common)
        for sidecar in [ydl.prepare_filename(changed, 'infojson'), subtitles_filename(str(final),'zh-Hans','vtt','mp4'), replace_extension(str(final),'jpg','mp4')]:
            assert Path(sidecar).parent == final.parent, sidecar
        cases.append(str(final.relative_to(root)))
print(json.dumps(cases, ensure_ascii=False))
`,
      template,
    ],
    { encoding: "utf8" },
  ),
);
assert.equal(result.length, 2);
process.stdout.write(
  `Offline real yt-dlp multipart naming and sidecars passed: ${JSON.stringify(result)}\n`,
);
