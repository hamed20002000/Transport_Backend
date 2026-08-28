import { Injectable } from '@nestjs/common';
import { PendingAction } from '../types';



@Injectable()
export class PendingConfirmationService {
    private pending = new Map<string, PendingAction>();

    set(userId: string, action: PendingAction): void {
        this.pending.set(userId, action);
    }

    get(userId: string): PendingAction | undefined {
        return this.pending.get(userId);
    }

    clear(userId: string): void {
        this.pending.delete(userId);
    }
}