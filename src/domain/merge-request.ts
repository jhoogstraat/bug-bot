import { z } from "zod";

export const MergeRequest = z.object({
  id: z.string(),
  url: z.url()
})

export type MergeRequest = z.infer<typeof MergeRequest>

export interface CreateMergeRequestInput {
  repositoryPath: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
}
