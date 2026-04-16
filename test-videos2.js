const { listYoutubeVideos } = require('./lib/acquire/YoutubeVideosStore.js');
(async () => {
    try {
        const res = await listYoutubeVideos();
        console.log("Full res:", Object.keys(res));
        if (res.data) console.log("Data length:", res.data.length);
        else console.log(res);
    } catch (e) {
        console.error(e);
    }
})();
