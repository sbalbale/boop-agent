import express from "express";
import { deleteSkill, listSkillsFull, writeSkill } from "./skills.js";

export function createSkillsRouter(): express.Router {
  const router = express.Router();

  router.get("/", (_req, res) => {
    res.json({ skills: listSkillsFull() });
  });

  router.post("/", (req, res) => {
    const body = req.body as { name?: unknown; description?: unknown; body?: unknown };
    if (typeof body.name !== "string" || typeof body.description !== "string" || typeof body.body !== "string") {
      res.status(400).json({ error: "name, description, and body are all required strings." });
      return;
    }
    try {
      const result = writeSkill(body.name, body.description, body.body, "self-authored");
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/:name", (req, res) => {
    try {
      deleteSkill(req.params.name);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
