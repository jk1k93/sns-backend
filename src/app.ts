import "dotenv/config";
import cors from "cors";
import express from "express";
import routes from "./routes/index.js";

const PORT = Number(process.env.PORT) || 8080;

const app = express();
app.use(cors());
app.use(express.json());
app.use(routes);

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
