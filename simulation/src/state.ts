import type { TaskAssignment } from "./types.js";

export class TaskState {
  private betaQueue: TaskAssignment[] = [];
  private gammaQueue: TaskAssignment[] = [];
  private assignments = new Map<string, TaskAssignment>();
  private pendingValidation = new Map<
    string,
    { worker: string; traceHash: string; ipfsURI: string }
  >();

  enqueueForWorker(task: TaskAssignment): void {
    this.assignments.set(task.taskId, task);
    if (task.worker === "beta") {
      this.betaQueue.push(task);
      return;
    }
    this.gammaQueue.push(task);
  }

  nextBetaTask(): TaskAssignment | undefined {
    return this.betaQueue.shift();
  }

  nextGammaTask(): TaskAssignment | undefined {
    return this.gammaQueue.shift();
  }

  markSubmitted(
    taskId: string,
    worker: string,
    traceHash: string,
    ipfsURI: string,
  ): void {
    this.pendingValidation.set(taskId, { worker, traceHash, ipfsURI });
  }

  pending(): Array<{
    taskId: string;
    worker: string;
    traceHash: string;
    ipfsURI: string;
    task: TaskAssignment;
  }> {
    return [...this.pendingValidation.entries()]
      .map(([taskId, value]) => {
        const task = this.assignments.get(taskId);
        if (!task) return null;
        return {
          taskId,
          ...value,
          task,
        };
      })
      .filter(
        (
          item,
        ): item is {
          taskId: string;
          worker: string;
          traceHash: string;
          ipfsURI: string;
          task: TaskAssignment;
        } => item !== null,
      );
  }

  markSettled(taskId: string): void {
    this.pendingValidation.delete(taskId);
    this.assignments.delete(taskId);
  }
}
