import { BotAction } from './botDialog';

/** Button rows for a BotReply: each add() is one row, grid() makes rows of `perRow`. */
export class BotRows {
  private row = 0;
  readonly actions: BotAction[] = [];

  add(...actions: BotAction[]): this {
    if (!actions.length) return this;
    this.actions.push(...actions.map((action) => ({ ...action, row: this.row })));
    this.row++;
    return this;
  }

  grid(actions: BotAction[], perRow = 2): this {
    for (let i = 0; i < actions.length; i += perRow) this.add(...actions.slice(i, i + perRow));
    return this;
  }
}
