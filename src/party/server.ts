import type * as Party from "partykit/server";
import * as Y from "yjs";
import { onConnect, type YPartyKitOptions } from "y-partykit";
import type { Doc } from "yjs";
import { SINGLETON_ROOM_ID } from "./rooms";

type Version = {
  date: number;
  snapshot: Uint8Array;
  clientID: number;
  username: string;
};

export default class EditorServer implements Party.Server {
  yjsOptions: YPartyKitOptions = {
    persist: false
  };
  
  constructor(public room: Party.Room) {}

  getOpts() {
    // options must match when calling unstable_getYDoc and onConnect
    const opts: YPartyKitOptions = {
      callback: { handler: (doc) => this.handleYDocChange(doc) },
    };
    return opts;
  }

  async onConnect(conn: Party.Connection) {
    await this.updateCount();
    return onConnect(conn, this.room, this.getOpts());
  }

  async onClose(_: Party.Connection) {
    await this.updateCount();
  }

  handleYDocChange(doc: Doc) {
    doc.gc = false;
    const versions = doc.getArray<Version>("versions");

    // Convert all versions to their prosemirror text content and usernames
    const states = versions.toArray().map(version => {
      const snapshot = version.snapshot;
      if (snapshot) {
        const state = Y.createDocFromSnapshot(doc, Y.decodeSnapshot(snapshot));
        return {
          state: state.getXmlFragment("prosemirror").toString(),
          username: version.username,
          timestamp: version.date
        };
      }
      return null;
    }).filter(Boolean);

    console.log(states);
  }

  async updateCount() {
    // Count the number of live connections
    const count = [...this.room.getConnections()].length;
    // Send the count to the 'rooms' party using HTTP POST
    await this.room.context.parties.rooms.get(SINGLETON_ROOM_ID).fetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        room: this.room.id, 
        count,
      }),
    });
  }
}
