/**
 * The extractor contract. One source of truth: these zod schemas both (a) drive
 * the LLM's tool input_schema and (b) validate what comes back. Output shape is
 * intentionally flatter than the DB (bullets are plain strings here; the persist
 * layer stamps each with a source_id).
 */
import { z } from "zod";

export const linkSchema = z.object({
  label: z.string(),
  url: z.string(),
});

export const extractedProfile = z.object({
  fullName: z.string().nullable(),
  headline: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  links: z.array(linkSchema).default([]),
});

export const extractedExperience = z.object({
  org: z.string().nullable(),
  title: z.string().nullable(),
  employmentType: z.string().nullable(),
  location: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  isCurrent: z.boolean().default(false),
  bullets: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.8),
});

export const extractedEducation = z.object({
  institution: z.string().nullable(),
  degree: z.string().nullable(),
  field: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  details: z.string().nullable(),
  confidence: z.number().min(0).max(1).default(0.8),
});

export const extractedSkill = z.object({
  name: z.string(),
  category: z.string().nullable(),
  confidence: z.number().min(0).max(1).default(0.7),
});

export const extractedProject = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
  links: z.array(linkSchema).default([]),
  bullets: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.7),
});

export const resumeExtraction = z.object({
  profile: extractedProfile,
  experiences: z.array(extractedExperience).default([]),
  education: z.array(extractedEducation).default([]),
  skills: z.array(extractedSkill).default([]),
  projects: z.array(extractedProject).default([]),
});

export type ResumeExtraction = z.infer<typeof resumeExtraction>;
