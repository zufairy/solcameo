/* The lab's camera planner now lives in lib/builder/cameraPlanner.ts so the
   Editor preview and the burn run the identical algorithm. Re-exported here so
   the page keeps its local import. */
export * from "@/lib/builder/cameraPlanner";
export type { ShotLike as Shot } from "@/lib/builder/cameraPlanner";
