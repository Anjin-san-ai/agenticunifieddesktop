import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import cors from 'cors';
import apiRouter from './routes/api.js';
import logger from './utils/logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

if (logger.isDebug) {
	logger.debug('Starting server with debug enabled', { argv: process.argv.slice(2), envPORT: process.env.PORT });
} else {
	logger.info('Starting server');
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Global request logger for diagnostics
app.use((req, res, next) => {
	logger.info('REQ', { method: req.method, url: req.originalUrl });
	next();
});

// Static assets
const __dirnameResolved = path.resolve();
const staticDir = path.join(__dirnameResolved, 'public');
if (logger.isDebug) {
	app.use((req, res, next) => {
		// Disable caching in debug to ensure latest JS/CSS load
		res.setHeader('Cache-Control', 'no-store');
		next();
	});
}
app.use(express.static(staticDir, logger.isDebug ? { etag: false, lastModified: false, cacheControl: true } : undefined));
// Also serve project images folder for branding assets
const imagesDir = path.join(__dirnameResolved, 'images');
app.use('/images', express.static(imagesDir, logger.isDebug ? { etag: false, lastModified: false, cacheControl: true } : undefined));

// API
app.use('/api', apiRouter);

// Fallback to SPA index
app.get('*', (req, res) => {
	res.sendFile(path.join(__dirnameResolved, 'public', 'index.html'));
});

app.listen(PORT, () => {
	logger.info(`Athena Desktop server running on port ${PORT}`);
	if (logger.isDebug) logger.debug('Express app listening callback executed');
});
