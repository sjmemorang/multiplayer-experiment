/* eslint-env browser */

import * as Y from "yjs";
import WebsocketProvider from "y-partykit/provider";
import {
  ySyncPlugin,
  ySyncPluginKey,
  yCursorPlugin,
  yUndoPlugin,
  undo,
  redo,
} from "y-prosemirror";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "./schema.js";
import { exampleSetup } from "prosemirror-example-setup";
import { keymap } from "prosemirror-keymap";
import * as random from "lib0/random.js";
import { html, render } from "lit-html";
import * as dom from "lib0/dom.js";
import * as pair from "lib0/pair.js";

/**
 * @typedef {Object} Version
 * @property {number} date
 * @property {Uint8Array} snapshot
 * @property {number} clientID
 * @property {string} username
 */

/**
 * @param {Y.Doc} doc
 * @param {string} username
 */
const addVersion = (doc, username) => {
  const versions = doc.getArray("versions");
  const prevVersion =
    versions.length === 0 ? null : versions.get(versions.length - 1);
  const prevSnapshot =
    prevVersion === null
      ? Y.emptySnapshot
      : Y.decodeSnapshot(prevVersion.snapshot);
  const snapshot = Y.snapshot(doc);
  if (prevVersion != null) {
    // account for the action of adding a version to ydoc
    prevSnapshot.sv.set(
      prevVersion.clientID,
      /** @type {number} */ (prevSnapshot.sv.get(prevVersion.clientID)) + 1
    );
  }
  if (!Y.equalSnapshots(prevSnapshot, snapshot)) {
    // Ensure we're storing a valid timestamp
    const currentTime = new Date().getTime();
    versions.push([
      {
        date: currentTime,
        snapshot: Y.encodeSnapshot(snapshot),
        clientID: doc.clientID,
        username: username
      },
    ]);
  }
};

/**
 * Sets up automatic snapshots at regular intervals
 * @param {Y.Doc} doc - The Yjs document
 * @param {string} username - The username
 * @param {number} intervalSeconds - Interval in seconds between snapshots
 * @returns {() => void} - Function to stop the automatic snapshots
 */
const setupAutoSnapshot = (doc, username, intervalSeconds = 5) => {
  const intervalId = setInterval(() => {
    addVersion(doc, username);
  }, intervalSeconds * 1000);
  
  // Return a function to stop the automatic snapshots
  return () => clearInterval(intervalId);
};

const liveTracking = /** @type {HTMLInputElement} */ (
  dom.element("input", [
    pair.create("type", "checkbox"),
    pair.create("name", "yjs-live-tracking"),
    pair.create("value", "Live Tracking "),
  ])
);

const updateLiveTrackingState = (editorstate) => {
  setTimeout(() => {
    const syncState = ySyncPluginKey.getState(editorstate.state);
    liveTracking.checked =
      syncState.prevSnapshot != null && syncState.snapshot == null;
  }, 500);
};

const renderVersion = (editorview, version, prevSnapshot) => {
  editorview.dispatch(
    editorview.state.tr.setMeta(ySyncPluginKey, {
      snapshot: Y.decodeSnapshot(version.snapshot),
      prevSnapshot:
        prevSnapshot == null ? Y.emptySnapshot : Y.decodeSnapshot(prevSnapshot),
    })
  );
  updateLiveTrackingState(editorview);
};

const unrenderVersion = (editorview) => {
  const binding = ySyncPluginKey.getState(editorview.state).binding;
  if (binding != null) {
    binding.unrenderSnapshot();
  }
  updateLiveTrackingState(editorview);
};

/**
 * @param {EditorView} editorview
 * @param {Version} version
 * @param {Version|null} prevSnapshot
 * @param {Y.PermanentUserData} permanentUserData
 */
const versionTemplate = (
  editorview,
  version,
  prevSnapshot,
  permanentUserData
) => {
  // Ensure the date is valid by checking if it's a number and within reasonable range
  const timestamp =
    typeof version.date === "number" && version.date > 0
      ? version.date
      : Date.now();

  // Use the stored username if available, otherwise fall back to PermanentUserData
  const username = version.username || 
    permanentUserData.getUserByClientId(version.clientID) || 
    "Unknown user";

  return html`<div
    class="version-list"
    @click=${() => renderVersion(editorview, version, prevSnapshot)}
  >
    ${new Date(timestamp).toLocaleString()} by ${username}
  </div>`;
};

const versionList = (editorview, doc, permanentUserData) => {
  const versions = doc.getArray("versions");
  return html`<div>
    ${versions.length > 0
      ? versions.map((version, i) =>
          versionTemplate(
            editorview,
            version,
            i > 0 ? versions.get(i - 1).snapshot : null,
            permanentUserData
          )
        )
      : html`<div>No snapshots..</div>`}
  </div>`;
};

const snapshotButton = (doc, username) => {
  return html`<button @click=${() => addVersion(doc, username)}>Snapshot</button>`;
};

/**
 * @param {HTMLElement} parent
 * @param {Y.Doc} doc
 * @param {EditorView} editorview
 * @param {Y.PermanentUserData} permanentUserData
 * @param {string} username
 */
export const attachVersion = (parent, doc, editorview, permanentUserData, username) => {
  let open = false;
  const rerender = () => {
    render(
      html`<div class="version-modal" ?hidden=${open}>
        ${snapshotButton(doc, username)}${versionList(editorview, doc, permanentUserData)}
      </div>`,
      vContainer
    );
  };
  
  // Start automatic snapshots every 5 seconds
  setupAutoSnapshot(doc, username, 5);
  
  updateLiveTrackingState(editorview);
  liveTracking.addEventListener("click", () => {
    if (liveTracking.checked) {
      const versions = doc.getArray("versions");
      const lastVersion =
        versions.length > 0
          ? Y.decodeSnapshot(versions.get(versions.length - 1).snapshot)
          : Y.emptySnapshot;
      editorview.dispatch(
        editorview.state.tr.setMeta(ySyncPluginKey, {
          snapshot: null,
          prevSnapshot: lastVersion,
        })
      );
    } else {
      unrenderVersion(editorview);
    }
  });
  parent.insertBefore(liveTracking, null);
  parent.insertBefore(
    dom.element(
      "label",
      [pair.create("for", "yjs-live-tracking")],
      [dom.text("Live Tracking ")]
    ),
    null
  );
  const btn = document.createElement("button");
  btn.setAttribute("type", "button");
  btn.textContent = "Versions";
  btn.addEventListener("click", () => {
    open = !open;
    unrenderVersion(editorview);
    rerender();
  });
  const vContainer = document.createElement("div");
  parent.insertBefore(btn, null);
  parent.insertBefore(vContainer, null);
  doc.getArray("versions").observe(rerender);
  rerender();
};

const testUsers = [
  { username: "Alice", color: "#ecd444", lightColor: "#ecd44433" },
  { username: "Bob", color: "#ee6352", lightColor: "#ee635233" },
  { username: "Max", color: "#6eeb83", lightColor: "#6eeb8333" },
];

const colors = [
  { light: "#ecd44433", dark: "#ecd444" },
  { light: "#ee635233", dark: "#ee6352" },
  { light: "#6eeb8333", dark: "#6eeb83" },
];

window.addEventListener("load", () => {
  // Prompt the user for their username before initializing
  const username = prompt("Please enter your username:", "");
  
  // If user cancels or enters empty string, use a default name
  const userDisplayName = username ? username.trim() : "Anonymous";
  
  // Select a random color for the user
  const userColor = random.oneOf(colors);
  
  // Create a user object with the provided username and random color
  const user = {
    username: userDisplayName,
    color: userColor.dark,
    lightColor: userColor.light
  };
  
  const ydoc = new Y.Doc();
  const permanentUserData = new Y.PermanentUserData(ydoc);
  permanentUserData.setUserMapping(ydoc, ydoc.clientID, user.username);
  ydoc.gc = false;
  const provider = new WebsocketProvider(
    window.location.host,
    "default",
    ydoc
  );
  const yXmlFragment = ydoc.get("prosemirror", Y.XmlFragment);

  const editor = document.createElement("div");
  editor.setAttribute("id", "editor");
  const editorContainer = document.createElement("div");
  editorContainer.insertBefore(editor, null);
  const prosemirrorView = new EditorView(editor, {
    state: EditorState.create({
      schema,
      plugins: [
        ySyncPlugin(yXmlFragment, { permanentUserData, colors }),
        yCursorPlugin(provider.awareness),
        yUndoPlugin(),
        keymap({
          "Mod-z": undo,
          "Mod-y": redo,
          "Mod-Shift-z": redo,
        }),
      ].concat(exampleSetup({ schema })),
    }),
  });
  document.body.insertBefore(editorContainer, null);

  attachVersion(
    document.getElementById("y-version"),
    ydoc,
    prosemirrorView,
    permanentUserData,
    user.username
  );

  const connectBtn = document.getElementById("y-connect-btn");
  connectBtn.addEventListener("click", () => {
    if (provider.shouldConnect) {
      provider.disconnect();
      connectBtn.textContent = "Connect";
    } else {
      provider.connect();
      connectBtn.textContent = "Disconnect";
    }
  });

  // @ts-ignore
  window.example = { provider, ydoc, yXmlFragment, prosemirrorView };
});
