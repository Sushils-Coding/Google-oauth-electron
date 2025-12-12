require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");
const multer = require("multer");
const stream = require("stream");

const app = express();
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// In-memory storage for events (replace with database if needed)
const eventsStore = {};

// In-memory storage for gallery images per event
const galleryStore = {};

// Store the latest tokens so Electron can fetch it later
let latestRefreshToken = null;
let latestAccessToken = null;
let tokenCreatedAt = null;

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Set refresh token from environment
if (process.env.REFRESH_TOKEN) {
  oauth2Client.setCredentials({
    refresh_token: process.env.REFRESH_TOKEN
  });
}

// API: Generate OAuth URL
app.get("/auth-url", (req, res) => {
  const scopes = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/drive.file",
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
  });

  res.json({ url });
});

// app.get('/', async(req, res) => {
//     res.send("hello world!");
// })

// API: OAuth Callback (Google redirects here)
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    latestRefreshToken = tokens.refresh_token;
    tokenCreatedAt = new Date().toISOString();

    // Generating access token using refresh token
    const newAccessToken = await oauth2Client.getAccessToken();
    latestAccessToken = newAccessToken.token;

    console.log("Refresh Token:", latestRefreshToken);
    console.log("Access Token:", latestAccessToken);

    return res.send(`
      <h2>Login successful!</h2>
      <p>You can now close this window and return to the Electron app.</p>
    `);
  } catch (err) {
    console.error("Error exchanging code for token:", err);
    return res.status(500).send("Error during authentication");
  }
});

// API: Electron fetches refresh token from here

app.get("/get-latest-tokens", (req, res) => {
  res.json({
    refreshToken: latestRefreshToken,
    accessToken: latestAccessToken,
    idToken: oauth2Client.credentials.id_token,
    expiryDate: oauth2Client.credentials.expiry_date,
    createdAt: tokenCreatedAt,
  });
});

// API: Create Event
app.post("/create-event", upload.single("thumbnail"), async (req, res) => {
  try {
    const { eventName, userId } = req.body;
    const file = req.file;

    if (!eventName || !file || !userId) {
      return res.status(400).json({ error: "Event name, thumbnail, and userId are required" });
    }

    // Initialize Google Drive API
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Create a readable stream from buffer
    const bufferStream = new stream.PassThrough();
    bufferStream.end(file.buffer);

    // Upload file to Google Drive
    const fileMetadata = {
      name: `${Date.now()}_${file.originalname}`,
      parents: [] // You can specify a folder ID here if needed
    };

    const media = {
      mimeType: file.mimetype,
      body: bufferStream
    };

    const driveFile = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id, webViewLink, webContentLink"
    });

    // Make the file publicly accessible
    await drive.permissions.create({
      fileId: driveFile.data.id,
      requestBody: {
        role: "reader",
        type: "anyone"
      }
    });

    // Use server proxy URL for images to avoid CORS and permission issues
    const thumbnailUrl = `http://localhost:8080/image/${driveFile.data.id}`;

    // Store event in memory (replace with database if needed)
    const eventId = Date.now().toString();
    const eventData = {
      eventName,
      thumbnailUrl,
      fileId: driveFile.data.id,
      userId,
      createdAt: new Date().toISOString(),
    };

    if (!eventsStore[userId]) {
      eventsStore[userId] = [];
    }
    eventsStore[userId].push({ id: eventId, ...eventData });

    res.json({
      success: true,
      eventId,
      thumbnailUrl,
      message: "Event created successfully",
    });
  } catch (err) {
    console.error("Error creating event:", err);
    res.status(500).json({ error: "Failed to create event", details: err.message });
  }
});

// API: Get Events for a user
app.get("/get-events/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    
    const events = eventsStore[userId] || [];

    // Sort by createdAt descending
    const sortedEvents = events.sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json({ events: sortedEvents });
  } catch (err) {
    console.error("Error fetching events:", err);
    res.status(500).json({ error: "Failed to fetch events", details: err.message });
  }
});

// API: Serve image from Google Drive
app.get("/image/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    
    // Initialize Google Drive API with credentials
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Get file metadata to check if it exists
    const fileMetadata = await drive.files.get({
      fileId: fileId,
      fields: "mimeType, name"
    });

    // Stream the file from Google Drive
    const response = await drive.files.get(
      { fileId: fileId, alt: "media" },
      { responseType: "stream" }
    );

    // Set the appropriate content type
    res.setHeader("Content-Type", fileMetadata.data.mimeType);
    res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 24 hours

    // Pipe the file stream to response
    response.data.pipe(res);
  } catch (err) {
    console.error("Error fetching image from Google Drive:", err);
    res.status(500).json({ error: "Failed to fetch image", details: err.message });
  }
});

// API: Get single event details
app.get("/get-event/:eventId", async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Search for the event across all users
    for (const userId in eventsStore) {
      const event = eventsStore[userId].find(e => e.id === eventId);
      if (event) {
        return res.json({ event });
      }
    }
    
    res.status(404).json({ error: "Event not found" });
  } catch (err) {
    console.error("Error fetching event:", err);
    res.status(500).json({ error: "Failed to fetch event", details: err.message });
  }
});

// API: Upload image to gallery
app.post("/gallery/upload", upload.single("image"), async (req, res) => {
  try {
    const { eventId } = req.body;
    const file = req.file;

    if (!eventId || !file) {
      return res.status(400).json({ error: "Event ID and image are required" });
    }

    // Initialize Google Drive API
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Create a readable stream from buffer
    const bufferStream = new stream.PassThrough();
    bufferStream.end(file.buffer);

    // Upload file to Google Drive
    const fileMetadata = {
      name: `gallery_${eventId}_${Date.now()}_${file.originalname}`,
      parents: []
    };

    const media = {
      mimeType: file.mimetype,
      body: bufferStream
    };

    const driveFile = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id, webViewLink, webContentLink"
    });

    // Make the file publicly accessible
    await drive.permissions.create({
      fileId: driveFile.data.id,
      requestBody: {
        role: "reader",
        type: "anyone"
      }
    });

    // Use server proxy URL for images
    const imageUrl = `http://localhost:8080/image/${driveFile.data.id}`;

    // Store gallery image
    const imageId = Date.now().toString();
    const imageData = {
      id: imageId,
      imageUrl,
      fileId: driveFile.data.id,
      eventId,
      uploadedAt: new Date().toISOString(),
    };

    if (!galleryStore[eventId]) {
      galleryStore[eventId] = [];
    }
    galleryStore[eventId].push(imageData);

    res.json({
      success: true,
      imageId,
      imageUrl,
      message: "Image uploaded successfully",
    });
  } catch (err) {
    console.error("Error uploading gallery image:", err);
    res.status(500).json({ error: "Failed to upload image", details: err.message });
  }
});

// API: Get gallery images for an event
app.get("/gallery/:eventId", async (req, res) => {
  try {
    const { eventId } = req.params;
    
    const images = galleryStore[eventId] || [];

    // Sort by uploadedAt descending
    const sortedImages = images.sort((a, b) => 
      new Date(b.uploadedAt) - new Date(a.uploadedAt)
    );

    res.json({ images: sortedImages });
  } catch (err) {
    console.error("Error fetching gallery images:", err);
    res.status(500).json({ error: "Failed to fetch gallery images", details: err.message });
  }
});

app.listen(8080, () => {
  console.log("Backend running on http://localhost:8080");
});
