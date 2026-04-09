const { runYoutubeHarvest } = require('./lib/acquire/YoutubeDetailsRun.js');

async function test() {
  try {
    const res = await runYoutubeHarvest({ video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    console.log("Title extracted:", res.video.title);
    console.log("Channel owner:", res.channel_owner.name);
  } catch(e) {
    console.error(e);
  }
}
test();
