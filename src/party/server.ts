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

type LastChangeInfo = {
  clientID: number;
  username: string;
  timestamp: number;
};

export default class EditorServer implements Party.Server {
  yjsOptions: YPartyKitOptions = {
    gc: false,
  };
  
  // Track the last state vector to detect changes
  private lastStateVector: Map<number, number> = new Map();
  private lastChangeInfo: LastChangeInfo | null = null;
  
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
    
    // Detect which client made the latest change
    const currentStateVector = Y.encodeStateVector(doc);
    const decodedStateVector = Y.decodeStateVector(currentStateVector);
    
    // If this is the first time we're seeing the document
    if (this.lastStateVector.size === 0) {
      this.lastStateVector = new Map(decodedStateVector);
    } else {
      // Find which client made changes by comparing state vectors
      let changedClientID: number | null = null;
      
      for (const [clientID, clock] of decodedStateVector.entries()) {
        const previousClock = this.lastStateVector.get(clientID) || 0;
        if (clock > previousClock) {
          changedClientID = clientID;
          // Update our stored state vector
          this.lastStateVector.set(clientID, clock);
        }
      }
      
      // If we found a client that made changes
      if (changedClientID !== null) {
        // Try to get the username from PermanentUserData or versions
        let username = "Unknown user";
        
        // Check if we can find the username in the versions array
        const versions = doc.getArray<Version>("versions");
        for (let i = versions.length - 1; i >= 0; i--) {
          const version = versions.get(i);
          if (version.clientID === changedClientID && version.username) {
            username = version.username;
            break;
          }
        }
        
        // Store the last change info
        this.lastChangeInfo = {
          clientID: changedClientID,
          username: username,
          timestamp: Date.now()
        };
      }
    }
    
    console.log(JSON.stringify({
      latest: doc.getXmlFragment('prosemirror').toString(),
      lastChange: this.lastChangeInfo,
    }, null, 2));
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
        lastChange: this.lastChangeInfo 
      }),
    });
  }
}
