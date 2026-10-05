import { z } from "zod";
export const dbcOptionsSchema = z
  .object({
    economy: z.enum(["creator-only", "sustainable-v1"]).default("creator-only"),
    shape: z.enum(["classic", "steady", "rocket", "whale"]).default("classic"),
    initialCapSol: z.number().min(0.1).max(1000).default(30),
    graduationCapSol: z.number().min(1).max(10000).default(250),
    feeBps: z
      .union([z.literal(25), z.literal(100), z.literal(200)])
      .default(100),
  })
  .refine(
    (v) => v.graduationCapSol >= v.initialCapSol * 2,
    "Graduation cap must be at least twice the opening cap.",
  );
export type DbcOptions = z.infer<typeof dbcOptionsSchema>;
export const DEFAULT_DBC = dbcOptionsSchema.parse({ economy: "sustainable-v1" });
