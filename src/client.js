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
 * @returns {boolean} Whether a new version was added
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
  
  // Only proceed if snapshots are different
  if (!Y.equalSnapshots(prevSnapshot, snapshot)) {
    // Get the local client ID
    const localClientID = doc.clientID;
    
    // Check if this client has made changes by examining the state vectors
    const prevSV = prevSnapshot.sv;
    const currentSV = snapshot.sv;
    
    // Get previous and current clock values for this client
    const prevClientClock = prevSV.get(localClientID) || 0;
    const currentClientClock = currentSV.get(localClientID) || 0;
    
    // Only add a version if this client's clock has increased
    // AND there's actual content in the document
    if (currentClientClock > prevClientClock && 
        doc.getXmlFragment('prosemirror').toString().length > 0) {
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
      return true;
    }
  }
  return false;
};

/**
 * Sets up automatic snapshots at regular intervals
 * @param {Y.Doc} doc - The Yjs document
 * @param {string} username - The username
 * @param {number} intervalSeconds - Interval in seconds between snapshots
 * @returns {() => void} - Function to stop the automatic snapshots
 */
const setupAutoSnapshot = (doc, username, intervalSeconds = 5) => {
  // Track the last time we successfully added a version
  let lastVersionTime = Date.now();
  
  // Track if the user has made substantive edits
  let hasUserMadeSubstantiveEdits = false;
  
  // Listen for document updates
  const updateHandler = (update, origin) => {
    // Only mark as edited if:
    // 1. The update originated from this client (not from the server)
    // 2. There's actual content in the document
    if (origin !== 'remote' && 
        doc.getXmlFragment('prosemirror').toString().length > 0) {
      hasUserMadeSubstantiveEdits = true;
    }
  };
  
  // Register the update handler
  doc.on('update', updateHandler);
  
  const intervalId = setInterval(() => {
    // Only try to add a version if:
    // 1. The user has made substantive edits
    // 2. Enough time has passed since the last version
    // 3. There's actual content in the document
    const currentTime = Date.now();
    if (hasUserMadeSubstantiveEdits && 
        currentTime - lastVersionTime >= intervalSeconds * 1000 &&
        doc.getXmlFragment('prosemirror').toString().length > 0) {
      const added = addVersion(doc, username);
      if (added) {
        lastVersionTime = currentTime;
      }
    }
  }, intervalSeconds * 1000);
  
  // Return a function to stop the automatic snapshots and clean up
  return () => {
    clearInterval(intervalId);
    doc.off('update', updateHandler);
  };
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
    
  // Get user color based on clientID for consistent coloring
  const userColor = getUserColor(version.clientID);

  return html`<div
    class="version-list"
    @click=${() => renderVersion(editorview, version, prevSnapshot)}
    style="border-left: 3px solid ${userColor}; padding-left: 5px;"
  >
    ${new Date(timestamp).toLocaleString()} by <span style="color: ${userColor}; font-weight: bold;">${username}</span>
  </div>`;
};

/**
 * Generates a consistent color for a user based on their clientID
 * @param {number} clientID - The client ID
 * @returns {string} - A CSS color string
 */
const getUserColor = (clientID) => {
  // List of distinct colors for users
  const userColors = [
    "#ecd444", // yellow
    "#ee6352", // red
    "#6eeb83", // green
    "#3fa7d6", // blue
    "#c17af4", // purple
    "#f49e4c", // orange
    "#ab3428", // dark red
    "#3d5a80", // navy
    "#55a630", // lime
    "#9e2a2b", // burgundy
    "#7209b7", // violet
    "#4cc9f0", // cyan
    "#fb8500", // bright orange
    "#2b9348", // forest green
    "#bc6c25", // brown
    "#8338ec", // indigo
    "#ff006e", // pink
    "#14213d", // dark blue
    "#5f0f40", // maroon
    "#0077b6"  // cerulean
  ];
  
  // Use the clientID to select a consistent color
  return userColors[clientID % userColors.length];
};

/**
 * Generates a lighter version of a color for backgrounds
 * @param {string} color - The base color in hex format
 * @param {number} opacity - Opacity value between 0 and 1
 * @returns {string} - A CSS rgba color string
 */
const getLightColor = (color, opacity = 0.2) => {
  // Convert hex to rgba
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
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
  // Track if the user has made substantive edits
  let hasUserMadeSubstantiveEdits = false;
  
  // Listen for document updates
  const updateHandler = (update, origin) => {
    // Only mark as edited if:
    // 1. The update originated from this client
    // 2. There's actual content in the document
    if (origin !== 'remote' && 
        doc.getXmlFragment('prosemirror').toString().length > 0) {
      hasUserMadeSubstantiveEdits = true;
    }
  };
  
  // Register the update handler
  doc.on('update', updateHandler);
  
  // Create the button element
  const button = html`<button 
    @click=${() => {
      if (hasUserMadeSubstantiveEdits && 
          doc.getXmlFragment('prosemirror').toString().length > 0) {
        addVersion(doc, username);
      } else if (doc.getXmlFragment('prosemirror').toString().length === 0) {
        alert("The document is empty.");
      } else {
        alert("You haven't made any changes yet.");
      }
    }}
  >Snapshot</button>`;
  
  // Clean up the event listener when the button is disconnected
  if (button.disconnected) {
    button.disconnected = () => {
      doc.off('update', updateHandler);
    };
  }
  
  return button;
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
  
  const ydoc = new Y.Doc();
  
  // Generate a consistent color based on the client ID
  const userColor = getUserColor(ydoc.clientID);
  const userLightColor = getLightColor(userColor);
  
  // Create a user object with the provided username and color
  const user = {
    username: userDisplayName,
    color: userColor,
    lightColor: userLightColor
  };
  
  const permanentUserData = new Y.PermanentUserData(ydoc);
  permanentUserData.setUserMapping(ydoc, ydoc.clientID, user.username);
  ydoc.gc = false;
  const provider = new WebsocketProvider(
    window.location.host,
    "default",
    ydoc
  );
  
  // Set awareness information for this user
  provider.awareness.setLocalStateField('user', {
    name: user.username,
    color: user.color,
    colorLight: user.lightColor
  });
  
  const yXmlFragment = ydoc.get("prosemirror", Y.XmlFragment);

  // Add CSS for highlighting user changes
  const styleElement = document.createElement('style');
  styleElement.textContent = `
    .user-change {
      transition: background-color 0.5s ease;
    }
    .user-change-highlight {
      transition: background-color 0s;
    }
  `;
  document.head.appendChild(styleElement);

  const editor = document.createElement("div");
  editor.setAttribute("id", "editor");
  const editorContainer = document.createElement("div");
  editorContainer.insertBefore(editor, null);
  const prosemirrorView = new EditorView(editor, {
    state: EditorState.create({
      schema,
      plugins: [
        ySyncPlugin(yXmlFragment, { 
          permanentUserData,
          // Use the same color system for highlighting changes
          colors: {
            getColor: getUserColor,
            getLocalColor: () => user.color,
            getLightColor: getLightColor
          }
        }),
        yCursorPlugin(provider.awareness, {
          // Configure cursor to show username
          cursorBuilder: (user) => {
            const cursor = document.createElement('span');
            cursor.classList.add('y-cursor');
            cursor.setAttribute('style', `border-color: ${user.color}`);
            
            // Create tooltip with username
            const tooltip = document.createElement('div');
            tooltip.textContent = user.name || 'Anonymous';
            tooltip.style.backgroundColor = user.color;
            tooltip.style.color = '#fff';
            
            cursor.appendChild(tooltip);
            return cursor;
          }
        }),
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
