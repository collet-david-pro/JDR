/** Reactive view of the notes of the map for the panels (the document itself is not reactive). */
import type { MapNote } from '../contracts-notes';
import type { NotesState } from '../model/NotesState';

/** Reactive view model of the notes panel. */
export class NotesView {
  list = $state.raw<readonly MapNote[]>([]);
  private readonly off: () => void;

  constructor(private readonly notes: NotesState) {
    this.list = notes.list();
    this.off = notes.onChanged(() => {
      this.list = notes.list();
    });
  }

  get(uid: string | null): MapNote | undefined {
    return uid === null ? undefined : this.list.find((n) => n.uid === uid);
  }

  dispose(): void {
    this.off();
  }
}
