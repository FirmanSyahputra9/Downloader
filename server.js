const fs = require('fs');
const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
let downloadStatus = {
  current: '',
  progress: 0,
  completed: 0,
  total: 0,
  queue: [],
  details: { size: '', duration: '' },
};
const downloadFolder = path.join(os.homedir(), 'Music');
app.post('/get-info', (req, res) => {
  const url = req.body.url;
  if (!url) return res.json({ error: 'URL kosong' });
  const command = `yt-dlp --flat-playlist -J "${url}"`;
  exec(command, (error, stdout) => {
    if (error) return res.json({ error: 'Gagal mengambil info' });
    try {
      const data = JSON.parse(stdout);
      let videos = [];
      if (data.entries) {
        data.entries.forEach((entry) => {
          videos.push({
            title: entry.title,
            url: `https://youtu.be/${entry.id}`,
            thumbnail: entry.thumbnail || (entry.thumbnails ? entry.thumbnails[0].url : '') || data.thumbnail,
          });
        });
      } else {
        videos.push({
          title: data.title,
          url: url,
          thumbnail: data.thumbnail,
        });
      }
      res.json({ videos });
    } catch (e) {
      res.json({ error: 'Parsing gagal' });
    }
  });
});
app.post('/download-selected', (req, res) => {
  let { videos, format, resolution } = req.body;
  if (!videos) {
    return res.json({ error: 'Tidak ada video' });
  }
  if (!Array.isArray(videos)) {
    videos = [videos];
  }
  downloadStatus.total = videos.length;
  downloadStatus.completed = 0;
  downloadStatus.queue = videos.map((v) => v.title);
  runQueue(videos, format, resolution);
  res.json({ started: true });
});
app.get('/status', (req, res) => {
  res.json(downloadStatus);
});
function runQueue(videos, format, resolution) {
  const downloadNext = (index) => {
    if (index >= videos.length) {
      downloadStatus.current = 'Semua selesai ✅';
      downloadStatus.progress = 100;
      downloadStatus.queue = [];
      downloadStatus.details = { size: '', duration: '', thumbnail: '' };
      return;
    }
    const video = videos[index];
    const infoCmd = `yt-dlp --print "%(duration_string)s" --print "%(filesize,filesize_approx)s" "${video.url}"`;
    exec(infoCmd, (err, stdout) => {
      const output = stdout.trim().split('\n');
      const duration = output[0] || '--:--';
      const rawSize = output[1] || '0';
      let sizeMB = 'Unknown';
      if (!isNaN(rawSize) && rawSize !== '0') {
        sizeMB = (parseInt(rawSize) / (1024 * 1024)).toFixed(2) + ' MB';
      }
      downloadStatus.current = video.title;
      downloadStatus.details = {
        size: sizeMB,
        duration: duration,
        thumbnail: video.thumbnail,
      };
      downloadStatus.progress = 0;
      let args;
      if (format === 'mp3') {
        args = ['-x', '--audio-format', 'mp3', '--newline', '-o', `${downloadFolder}/%(title)s.%(ext)s`, video.url];
      } else {
        let formatArg = resolution === 'best' ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]' : `bestvideo[height<=${resolution}][ext=mp4]+bestaudio[ext=m4a]`;
        args = ['-f', formatArg, '--merge-output-format', 'mp4', '--newline', '-o', `${downloadFolder}/%(title)s.%(ext)s`, video.url];
      }
      const ytdlp = spawn('yt-dlp', args);
      ytdlp.stdout.on('data', (data) => {
        const line = data.toString();
        const match = line.match(/(\d+(\.\d+)?)%/);
        if (match) downloadStatus.progress = parseFloat(match[1]);
      });
      ytdlp.on('close', () => {
        downloadStatus.completed++;
        downloadStatus.queue.shift();
        downloadNext(index + 1);
      });
    });
  };
  downloadNext(0);
}
app.listen(3000, () => {
  console.log('Server jalan di http://localhost:3000');
});
