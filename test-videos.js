const { listYoutubeVideos } = require('./lib/acquire/YoutubeVideosStore.js');
(async () => {
    try {
        const res = await listYoutubeVideos();
        console.log("Total returned:", res.data?.length);
        if (res.data?.length > 0) {
            console.log("First video title:", res.data[0].title);
        }
    } catch (e) {
        console.error(e);
    }
})();
