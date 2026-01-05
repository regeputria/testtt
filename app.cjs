const express = require("express");
const axios = require("axios");
const fetch = require("node-fetch"); 
const path = require('path');
const morgan = require("morgan");
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);
const cors = require('cors');
const app = express();

const BASE_URL = "https://netshort-api.vercel.app";
const CONSTANT_URL = `${BASE_URL}/api/drama/classes/constant`;
const FILTER_URL = `${BASE_URL}/api/drama/filter/query`;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan("dev"));

app.get('/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ success: false, data: [] });

  try {
    const response = await axios.get(
      `${BASE_URL}/api/drama/search/query?searchCode=${encodeURIComponent(q)}`
    );

    const data = response.data.data.map(item => ({
      id: item.shortPlayId,
      name: item.shortPlayName,
      cover: item.shortPlayCover,
      intro: item.shotIntroduce,
      labels: item.labelNames
    }));

    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, data: [] });
  }
});

app.get('/download/api/sub', async (req, res) => {
    try {
        const targetUrl = req.query.url;

        if (!targetUrl) {
            return res.status(400).json({ error: 'Parameter URL diperlukan.' });
        }

        const response = await axios({
            method: 'GET',
            url: targetUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const filename = 'subtitle.vtt';

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', response.headers['content-type'] || 'text/vtt');

        response.data.pipe(res);

    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Gagal mengunduh file dari sumber.',
                details: error.message 
            });
        }
    }
});

app.get("/", async (req, res) => {
  try {
    const { data } = await axios.get(CONSTANT_URL);
    const constants = data.data.data;

    const queryUrl = `${FILTER_URL}?tagId=Semua&orderMode=1&regionKey=0&audioKey=0&offset=1`;
    const response = await axios.get(queryUrl);
    const dramas = response.data.data?.dataList || [];
    const maxOffset = response.data.data?.maxOffset || 1;

    res.render("index", { constants, dramas, maxOffset });
  } catch (err) {
    res.send("❌ Gagal memuat data dari API.");
  }
});

app.get("/filter", async (req, res) => {
  try {
    const tagId = req.query.tagId || "Semua";
    const orderMode = req.query.orderMode || 1;
    const regionKey = req.query.regionKey || 0;
    const audioKey = req.query.audioKey || 0;
    const offset = req.query.offset || 1;

    const queryUrl = `${FILTER_URL}?tagId=${tagId}&orderMode=${orderMode}&regionKey=${regionKey}&audioKey=${audioKey}&offset=${offset}`;
    const response = await axios.get(queryUrl);

    const dramas = response.data.data?.dataList || [];
    const maxOffset = response.data.data?.maxOffset || 1;
    res.json({ success: true, dramas, maxOffset });
  } catch (err) {
    res.json({ success: false, message: "Gagal mengambil data filter" });
  }
});

async function fetchDramaData(id) {
  const url = `${BASE_URL}/api/drama/${id}?quality=720`;
  const { data } = await axios.get(url, { timeout: 10000 });
  if (!data || !data.success) throw new Error("Invalid response from remote API");
  return data.data;
}

app.get("/api/:slug/:id/:episodeNo?", async (req, res) => {
  try {
    const { id, episodeNo } = req.params;
    
    const response = await fetchDramaData(id); 
    
    const dramaDetails = response.dramaInfo || {};
    
    const episodesRaw = Array.isArray(response.result) 
        ? response.result 
        : (Array.isArray(response.shortPlayEpisodeInfos) ? response.shortPlayEpisodeInfos : []);

    const shortPlayName = dramaDetails.shortPlayName || "";
    const shortPlayCover = dramaDetails.shortPlayCover || "";
    const shortPlayLabels = dramaDetails.shortPlayLabels || [];
    const shotIntroduce = dramaDetails.shotIntroduce || dramaDetails.shortIntroduce || "";
    const episodes = episodesRaw;

    let selectedEpisode;
    if (episodeNo) selectedEpisode = episodes.find(ep => String(ep.episodeNo) === String(episodeNo));
    if (!selectedEpisode) selectedEpisode = episodes[0] || null;

    const playVoucher = selectedEpisode ? (selectedEpisode.playVoucher || selectedEpisode.videoUrl) : null;
    
    const subtitleUrl =
      selectedEpisode && Array.isArray(selectedEpisode.subtitleList) && selectedEpisode.subtitleList.length
        ? selectedEpisode.subtitleList[0].url
        : (selectedEpisode ? selectedEpisode.subtitle : null);

    const likeNums = selectedEpisode ? selectedEpisode.likeNums || null : null;
    const chaseNums = selectedEpisode ? selectedEpisode.chaseNums || null : null;
    const playClarity = selectedEpisode ? selectedEpisode.playClarity || null : null;
    
    if (req.accepts("json") && !req.accepts("html")) {
        const jsonResponseData = {
          success: true,
          data: {
            shortPlayName,
            shortPlayCover,
            shortPlayLabels,
            shotIntroduce,
            episodeNo: selectedEpisode ? selectedEpisode.episodeNo : null,
            playVoucher,
            subtitleUrl,
            likeNums,
            chaseNums,
            playClarity,
          },
        };
        
      return res.json(jsonResponseData);
    }

    const renderData = {
      shortPlayName,
      shortPlayCover,
      shortPlayLabels,
      shotIntroduce,
      episodes,
      selectedEpisode,
      subtitleUrl,
      likeNums,
      chaseNums,
      playClarity,
      id,
      playVoucher
    };

    res.render("player", renderData);

  } catch (err) {
    res.status(500).send(err.message || "Server error");
  }
});

function parseSlug(slug) {
  const match = slug.match(/-(\d+)-ep(\d+)$/);
  if (!match) return null;
  return {
    shortPlayId: match[1],
    episodeNo: match[2]
  };
}

async function fetchWithRetry(url, retries = 2) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Fetch gagal: ${res.status}`);
      return res;
    } catch (err) {
      attempt++;
      if (attempt > retries) throw err;
    }
  }
}

app.get('/download/api', async (req, res) => {
  const fileUrl = req.query.url;
  if (!fileUrl) return res.status(400).send('URL video diperlukan');

  try {
    const urlParts = fileUrl.split('/');
    const lastPart = urlParts[urlParts.length - 1];
    const originalFileName = lastPart.split('?')[0];
    const filename = 'regexd-com-' + originalFileName;

    const response = await fetchWithRetry(fileUrl);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');

    res.on('close', () => {
      response.body.destroy();
    });

    await streamPipeline(response.body, res);

  } catch (error) {
    if (!res.headersSent) res.status(500).send('Gagal mendownload video');
  }
});

app.listen(3000);
