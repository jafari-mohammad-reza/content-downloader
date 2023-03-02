import express, { Express, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import router from "./routes/router";

import {
  notFoundHandler,
  serverErrorHandler,
} from "./middlewares/server-errors";
import { downloadPlaylist } from "./controllers/youtube.controller";
dotenv.config();
const app: Express = express();
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === "development" ? "dev" : "short"));
app.use("/api", router);
app.use(notFoundHandler);
app.use(serverErrorHandler);
app.listen(process.env.APPLICATION_PORT, () => {
  console.log(`Listening on ${process.env.APPLICATION_PORT}`);
});