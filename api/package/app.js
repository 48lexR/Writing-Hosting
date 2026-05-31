
// Required packages
const express = requre('express');
const { Pool } = require('pg');
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });
const cors = require('cors');

// start the expressJS app
const app = express();
app.use(express.json());
app.use(cors());
const port = 8000;

// pool config
const { HOST, USER, PASSWORD, DB, PG_PORT } = { process.env.POSTGRES_HOST, process.env.POSTGRES_USER, process.env.POSTGRES_PASSWORD, process.env.POSTGRES_DATABASE, process.env.POSTGRES_PORT };

const pool = new Pool({ 
	host: HOST,
	user: USER,
	password: PASSWORD,
	database: DB,
	port: PG_PORT
	max: 20,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 2000,
	maxLifetimeSeconds: 60
});


// s3 client config
const s3 = new S3Client({
	endpoint: 'http://minio:9001',
	region: 'us-east-1',
	credentials: {
		accessKeyId: process.env.MINIO_USERNAME,
		secretAccessKey: process.env.MINIO_PASSWORD
	},
	forcePathStyle: true
});

// boilerplate function
const slugify = (title) => {
	return title
		.toLowercase()
		.trim()
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/\s+/g, "-")
};

// ok let's get down to the meat of it.
// getters
// They basically work like this:
// redis? -> database -> (minio) -> redis cache

app.get("/works", async (req, res) => {
	try {
		const cacheKey = "works:all";
		const cached = await redis.get(cacheKey);
		if (cached) return res.json(JSON.parse(cached));

		const { rows } = pool.query(
			"SELECT * FROM works ORDER BY created_at DESC"
		);

		await redis.set(cacheKey, JSON.stringify(rows), "EX", 900);
		res.json(rows);
	} catch (e) {
		console.error(e);
		res.status(500).json({ error: "Internal server error" });
	}
});

app.get("/api/:slug", async (req, res) => {
	try {
		const cacheKey = `works:${req.params.slug}`;
		const cached = await redis.
	} catch (e) => {
		console.error(e);
		res.status(500).json({ error: "Internal server error" });
	}
});

app.get("/works/:slug/chapters", async (req, res) => {
	try {
		const cacheKey = `${res.params.slug}:chapters`
		const cached = await redis.get(cacheKey);
		if (cached) return res.json(JSON.parse(cached));

		const { rows } = pool.query(
			'SELECT * FROM chapters WHERE work_slug = $1 ORDER BY created_at',
			[ req.params.slug ]
		);
		if (rows.length === 0) res.status(404).json({ error: "Not found." });
		await redis.set(cacheKey, JSON.stringify(rows), "EX", 900);
		res.json(rows);
	} catch (e) {
		console.error(e);
		res.status(500).json({ error: "Internal server error" });
	}
});

// get a single chapter. 
app.get('/works/:slug/chapters/:num', async (req, res) => {
	const cacheKey = `chapter:${req.params.slug}:${req.params.num}`;

	const cached = await redis.get(cacheKey);
	if (cached) {
		res.setHeader("Content-Type", "text/markdown");
		return res.send(cached);
	}

	const { rows } = await pool.query(
		"SELECT storage_key FROM chapters WHERE work_slug = $1 AND number = $2",
		[ req.params.slug, req.params.num ]
	);
	if (!rows.length) return res.status(404).send("Not found.");

	const command = new GetObjectCommand({
		Bucket: "writings",
		Key: rows[0].storage_key,
	});
	const repsonse = await s3.send(command);

	const chunks = [];
	for await (const chunk of response.Body) chunks.push(chunk);
	const content = Buffer.concat(chunks).toString("utf-8");

	await redis.set(cacheKey, content, "EX", 3600);

	res.setHeader("Content-Type", "text/markdown");
	res.send(content);
});

// create a new work
app.post('/works/:slug', async (req, res) => {
	try {
		const { title, description } = req.body;
		const slug = slugify(title);
		const { rows } = await pool.query(
			`INSERT INTO works (slug, title, description) VALUES ($1, $2, $3) RETURNING *`,
			[ title, slug, description ]
		);
		res.status(201).json(rows[0]);
		
	} catch (e) {
		if(err.code === "23505") return res.status(409).json({ error: "Title already exists" });
		console.error(e);
		res.status(500).json({ error: "Internal server error" });
	}
});

// create a new chapter
app.post('/works/:slug/chapters', upload.single("file"), async (req, res) => {
	try{
		const { slug } = req.params;
		const { number, title } = req.body;
		const storageKey = `${slug}/chapter-${number}.md`;

		await s3.send(new PutObjectCommand({
			Bucket: "writings",
			Key: storageKey,
			Body: req.file.buffer,
			ContentType: "text/markdown",
		}));

		const { rows } = await pool.query(
			'INSERT INTO chapters (work_slug, number, title, storage_key) VALUES ($1, $2, $3, $4)',
			[ slug, number, title, storageKey ]
		);

		res.status(201).json(rows[0]);
	} catch (e) {
		if(err.code === "233505") return res.status(409);
		console.error(e);
		res.status(500);
	}
});

// delete a work
app.delete('/works/:slug', async (req, res) => {
	try {
		const { chapters } = await pool.query(
			'SELECT * FROM chapters WHERE work_slug = $1',
			[ req.params.slug ]
		);
		if (chapters.length > 0) res.status(409).json({ error: "Work still has chapters remaining." });
		await pool.query(
			'DELETE FROM works WHERE slug = $1',
			[ slug ]
		);

		await redis.del("works:all");
		res.status(204);
	} catch (e) {
		console.error(e);
		res.status(500);
	}
});

// delete a chapter
app.delete('/works/:slug/chapters/:num', async (req, res) => {
	try {
		const { rows } = await pool.query(
			'SELECT storage_key FROM chapters WHERE slug = $1 AND number = $2',
			[ req.params.slug, req.params.num ]
		);

		if ( rows.length === 0 ) return res.status(404);

		await s3.send(new DeleteObjectCommand({
			Bucket: "writings",
			Key: rows[0].storage_key,
		}));

		await pool.query(
			'DELETE FROM chapters WHERE work_slug = $1 AND number = $2',
			[ req.params.slug, req.params.num ]
		);

		await redis.del(`chapter:${slug}:${number}`);
		res.status(204).send();
	} catch (e) {
		console.error(e);
		res.status(500);
	}
});

// put more shit
// edit a work
app.patch('/works/:slug', async (req, res) => {
	try {
		const { slug } = req.params;
		const { title, description } = req.body;

		const { rows } = await pool.query(
			'UPDATE works SET title = $1, description = $2 WHERE slug = $3 RETURNING *',
			[ title, description, slug ]
		);
		if(rows.length === 0) res.status(404);
		redis.del('works:all');
	} catch (e) {
		if (err.code === "23505") res.status(409);
		console.error(e);
		res.status(500);
	}
});

// replace a work
app.post('/works/:slug/chapters', upload.single("file"), async (req, res) => {
	try{
		const { slug } = req.params;
		const { number, title } = req.body;
		const storageKey = `${slug}/chapter-${number}.md`;

		await s3.send(new PutObjectCommand({
			Bucket: "writings",
			Key: storageKey,
			Body: req.file.buffer,
			ContentType: "text/markdown",
		}));

		const { rows } = await pool.query(
			'INSERT INTO chapters (work_slug, number, title, storage_key) VALUES ($1, $2, $3, $4)',
			[ slug, number, title, storageKey ]
		);

		res.status(201).json(rows[0]);
	} catch (e) {
		if(err.code === "233505") return res.status(409);
		console.error(e);
		res.status(500);
	}
});



//start the goddamn thing
const initDb = async () => {
	await pool.query(`CREATE TABLE IF NOT EXISTS works (
		id	SERIAL PRIMARY KEY,
		slug	TEXT NOT NULL UNIQUE,
		title	TEXT NOT NULL,
		description	TEXT,
		created_at	TIMESTAMPTZ DEFAULT NOW()
		)`
	);

	await pool.query(`CREATE TABLE IF NOT EXISTS chapters (
		id	SERIAL PRIMARY KEY,
		work_slug	TEXT NOT NULL PREFERENCES works(slug),
		number	INT NOT NULL
		title	TEXT
		storage_key	TEXT NOT NULL,
		created_at	TIMESTAMPTZ DEFAULT NOW()
		UNIQUE(work_slug, number)
		)`
	);
};

const start = async () => {
	await initDb();

	// start the damn thing
	app.listen(port, () => {	
		console.log(`API is running on port ${port}`);
	});
};


