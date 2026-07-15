import express from "express";
import { getSoulForEditing, resetSoul, saveSoul } from "./soul.js";

export function createSoulRouter(): express.Router {
  const router = express.Router();

  router.get("/", (_req, res) => {
    res.json(getSoulForEditing());
  });

  router.post("/", (req, res) => {
    const body = req.body as { content?: unknown };
    if (typeof body.content !== "string") {
      res.status(400).json({ error: "content is required." });
      return;
    }
    try {
      saveSoul(body.content);
      res.json(getSoulForEditing());
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/", (_req, res) => {
    resetSoul();
    res.json(getSoulForEditing());
  });

  return router;
}
