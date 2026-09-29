import express from "express";
import "dotenv/config";
import cors from "cors";
import http from "http";
import { connectDB } from "./lib/db.js";
import userRouter from "./routes/userRoutes.js";
import oauthRouter from "./routes/oauthRoutes.js";
import messageRouter from "./routes/messageRoutes.js";
import { Server } from "socket.io";
import path from "path";
import { setIO } from "./lib/socketIO.js";

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Initialize socket.io server
const allowedOrigins = new Set(
  [
    process.env.FRONTEND_URL,
    process.env.OAUTH_SUCCESS_REDIRECT,
    ...(process.env.SOCKET_ORIGINS || "").split(","),
    "http://localhost:5173",
    "http://localhost:3000",
  ]
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean),
);
const socketOrigins = [...allowedOrigins];

export const io = new Server(server, {
  cors: {
    origin: socketOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  },
});

// Register global io instance so controllers can broadcast events
setIO(io);

// Store online users
export const userSocketMap = {}; // { userId: socketId }
const emitOnlineUsers = () => {
  io.emit("getOnlineUsers", Object.keys(userSocketMap));
};

// Socket.io connection handler
io.on("connection", (socket) => {
  const userId = socket.handshake.query.userId;
  if (userId) {
    userSocketMap[userId] = socket.id;
    emitOnlineUsers();
  }

  // ---- Call signaling (audio/video) ----
  socket.on("call:request", ({ to, type, callerName }) => {
    const toSocketId = userSocketMap[to];
    if (toSocketId) {
      io.to(toSocketId).emit("call:incoming", {
        from: userId,
        type: type || "video",
        callerName: callerName || "Someone",
      });
    }
  });

  socket.on("call:accept", ({ to }) => {
    const toSocketId = userSocketMap[to];
    if (toSocketId) io.to(toSocketId).emit("call:accepted", { from: userId });
  });

  socket.on("call:reject", ({ to }) => {
    const toSocketId = userSocketMap[to];
    if (toSocketId) io.to(toSocketId).emit("call:rejected");
  });

  socket.on("call:end", ({ to }) => {
    const toSocketId = userSocketMap[to];
    if (toSocketId) io.to(toSocketId).emit("call:ended");
  });

  socket.on("webrtc:signal", ({ to, signal }) => {
    const toSocketId = userSocketMap[to];
    if (toSocketId)
      io.to(toSocketId).emit("webrtc:signal", { from: userId, signal });
  });

  socket.on("disconnect", () => {
    if (userId) {
      delete userSocketMap[userId];
      emitOnlineUsers();
    }
  });
});

// Middleware setup
app.use(express.json({ limit: "4mb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error("Origin is not allowed"));
    },
    credentials: true,
  }),
);
app.use((req, res, next) => {
  const isStateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(
    req.method,
  );
  const hasAuthCookie = req.headers.cookie
    ?.split(";")
    .some((cookie) => cookie.trim().startsWith("token="));
  const origin = req.get("origin");

  if (
    isStateChanging &&
    hasAuthCookie &&
    (!origin || !allowedOrigins.has(origin))
  ) {
    return res.status(403).json({
      success: false,
      message: "Request origin is not allowed",
    });
  }

  next();
});
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// demo route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// Routes setup
app.use("/api/status", (req, res) => res.send("Server is live"));
app.use("/api/auth", userRouter);
app.use("/api/auth", oauthRouter);
app.use("/api/messages", messageRouter);

// Serve static files (if self-hosted, not Vercel)
app.use(express.static("client/build"));

// Connect to MongoDB
await connectDB();

const isVercelRuntime =
  process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);

if (!isVercelRuntime) {
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () =>
    console.log("🚀 Server is running on PORT: " + PORT),
  );
}

// Export server for Vercel
export default server;
