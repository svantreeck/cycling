import { Emitter, type Unsubscribe } from './trainer';

/** What a handlebar controller button (or keyboard shortcut) asks the app to do. */
export type ControllerAction = 'shiftUp' | 'shiftDown' | 'harder' | 'easier' | 'skip' | 'pause' | 'resume' | 'select';

export interface Controller {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onAction(cb: (a: ControllerAction) => void): Unsubscribe;
  onDisconnect(cb: () => void): Unsubscribe;
}

/** On-screen stand-in for a controller, for development and the simulator. */
export class MockController implements Controller {
  readonly name = 'Simulated controller';
  private actions = new Emitter<ControllerAction>();
  private disconnects = new Emitter<void>();
  async connect() {}
  async disconnect() {}
  press(a: ControllerAction) {
    this.actions.emit(a);
  }
  onAction(cb: (a: ControllerAction) => void) {
    return this.actions.on(cb);
  }
  onDisconnect(cb: () => void) {
    return this.disconnects.on(cb);
  }
}
