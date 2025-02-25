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
    gc: false,
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
    console.log(JSON.stringify({
      latest: doc.getXmlFragment('prosemirror').toString(),
      versions: doc.getArray<Version>("versions").map((v) => ({
        date: v.date,
        state: Y.createDocFromSnapshot(doc, Y.decodeSnapshot(v.snapshot)).getXmlFragment('prosemirror').toString(),
        clientID: v.clientID,
        username: v.username,
      })),
    }, null, 2));
  }

  async updateCount() {
    // Count the number of live connections
    const count = [...this.room.getConnections()].length;
    // Send the count to the 'rooms' party using HTTP POST
    await this.room.context.parties.rooms.get(SINGLETON_ROOM_ID).fetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: this.room.id, count }),
    });
  }
}
