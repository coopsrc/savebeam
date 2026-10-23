// Real yt-dlp core/extractors, entirely offline. No media/user Cookie reads or writes.
import { execFileSync } from "node:child_process";
import process from "node:process";
if (!process.argv[2]) throw new Error("Pass Python with yt_dlp installed.");
process.stdout.write(
  execFileSync(
    process.argv[2],
    [
      "-c",
      String.raw`
import contextlib, io, json
from yt_dlp import YoutubeDL
from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.extractor.bilibili import BilibiliCollectionListIE

# Reproduce the missing-field behavior of the installed Bilibili flat extractor,
# providing its already-parsed API fixture directly rather than fetching a site.
with YoutubeDL({'quiet': True}, auto_init=False) as ydl:
    flat = list(BilibiliCollectionListIE(ydl)._get_entries({'archives':[
        {'bvid':'BVfixture', 'title':'Known API title', 'duration':123}]}, 'archives'))
assert flat[0]['id'] == 'BVfixture' and not flat[0].get('title'), flat

extracted=[]
class SavebeamVideoIE(InfoExtractor):
    _VALID_URL = r'savebeam-video:(?P<id>\d+)'
    def _real_extract(self,url):
        index=int(self._match_id(url)); extracted.append(index)
        return {'id':f'v{index}','title':f'Full title {index}','duration':120+index,
                'formats':[{'format_id':'one','url':'https://example.invalid/never-fetched.mp4','ext':'mp4','vcodec':'avc1','acodec':'aac'}]}
class SavebeamSeriesIE(InfoExtractor):
    _VALID_URL = r'savebeam-series:(?P<id>fixture)'
    def _real_extract(self,url):
        return self.playlist_result((self.url_result(f'savebeam-video:{i}',SavebeamVideoIE,video_id=f'v{i}') for i in range(1,1001)), 'fixture', 'Series')

with contextlib.redirect_stdout(io.StringIO()), YoutubeDL({
        'quiet':True,'no_warnings':True,'skip_download':True,'extract_flat':False,
        'playlist_items':'72,1000','playlistend':1001,'ignoreerrors':True,'check_formats':False,
        'format':'bestvideo+bestaudio/best'}, auto_init=False) as ydl:
    ydl.add_info_extractor(SavebeamVideoIE());ydl.add_info_extractor(SavebeamSeriesIE())
    result=ydl.extract_info('savebeam-series:fixture',download=False)
    entries=list(result['entries'])
assert extracted == [72,1000], extracted
assert [(e['playlist_index'],e['id'],e['title'],e['duration']) for e in entries] == [(72,'v72','Full title 72',192),(1000,'v1000','Full title 1000',1120)]
print(json.dumps({'flatBilibiliTitleMissingReproduced':True,'fullMetadataOriginalIndices':extracted,'skipDownload':True,'networkRequests':0}))
`,
    ],
    { encoding: "utf8" },
  ),
);
