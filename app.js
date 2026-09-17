/* Chat UI: chat list, message rendering, persistence, bot replies. */
(function () {
  "use strict";

  var STORAGE_KEY = "chatapp.state.v1";

  var CHATS = [
    { id: "bot",  name: "Bot",      avatar: "B",  kind: "bot",   status: "online" },
    { id: "echo", name: "Echo Bot", avatar: "E",  kind: "echo",  status: "online" },
    { id: "notes", name: "Notes (you)", avatar: "📝", kind: "notes", status: "message yourself" }
  ];

  var el = {
    app: document.querySelector(".app"),
    chatList: document.getElementById("chat-list"),
    messages: document.getElementById("messages"),
    composer: document.getElementById("composer"),
    input: document.getElementById("input"),
    search: document.getElementById("search"),
    peerName: document.getElementById("peer-name"),
    peerStatus: document.getElementById("peer-status"),
    peerAvatar: document.getElementById("peer-avatar"),
    back: document.getElementById("back"),
    clear: document.getElementById("clear")
  };

  var state = load();
  var activeId = state.activeId && findChat(state.activeId) ? state.activeId : CHATS[0].id;

  // Per-chat reply queue: `timers` so a chat can be cancelled, `freeAt` so
  // several messages sent in a row each get their own answer in order, and
  // `typing` so the indicator survives switching chats and back.
  var queues = {};

  function queueOf(chatId) {
    if (!queues[chatId]) queues[chatId] = { timers: [], freeAt: 0, typing: false };
    return queues[chatId];
  }

  /* ---------------- persistence ---------------- */

  function blankState() {
    var threads = {};
    CHATS.forEach(function (c) { threads[c.id] = []; });
    threads.bot = [{
      from: "them",
      text: "Hey! Say \"hi\" and I'll reply. Type \"help\" to see what I know.",
      at: Date.now() - 60000,
      read: true
    }];
    return { threads: threads, unread: {}, activeId: CHATS[0].id };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return blankState();
      var parsed = JSON.parse(raw);
      var base = blankState();
      CHATS.forEach(function (c) {
        if (Array.isArray(parsed.threads && parsed.threads[c.id])) {
          base.threads[c.id] = parsed.threads[c.id];
        }
      });
      base.unread = parsed.unread || {};
      base.activeId = parsed.activeId;
      return base;
    } catch (err) {
      return blankState();
    }
  }

  function save() {
    state.activeId = activeId;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      /* storage full or blocked (private mode) — the app still works in-memory */
    }
  }

  /* ---------------- helpers ---------------- */

  function findChat(id) {
    return CHATS.filter(function (c) { return c.id === id; })[0];
  }

  function thread(id) {
    if (!state.threads[id]) state.threads[id] = [];
    return state.threads[id];
  }

  function clockOf(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function dayLabelOf(ts) {
    var d = new Date(ts);
    var today = new Date();
    var yesterday = new Date(today.getTime() - 86400000);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  }

  function listStampOf(ts) {
    var d = new Date(ts);
    return d.toDateString() === new Date().toDateString() ? clockOf(ts) : dayLabelOf(ts);
  }

  /* ---------------- rendering ---------------- */

  function renderChatList() {
    var q = (el.search.value || "").trim().toLowerCase();
    el.chatList.innerHTML = "";

    CHATS.filter(function (chat) {
      if (!q) return true;
      var last = thread(chat.id).slice(-1)[0];
      return chat.name.toLowerCase().indexOf(q) !== -1 ||
        (last && last.text.toLowerCase().indexOf(q) !== -1);
    }).forEach(function (chat) {
      var msgs = thread(chat.id);
      var last = msgs[msgs.length - 1];
      var unread = state.unread[chat.id] || 0;

      var li = document.createElement("li");
      li.className = "chat-item" + (chat.id === activeId ? " active" : "");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", chat.id === activeId ? "true" : "false");
      li.tabIndex = 0;

      var avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.textContent = chat.avatar;

      var meta = document.createElement("div");
      meta.className = "meta";

      var row = document.createElement("div");
      row.className = "row";

      var name = document.createElement("span");
      name.className = "name";
      name.textContent = chat.name;

      var time = document.createElement("span");
      time.className = "time";
      time.textContent = last ? listStampOf(last.at) : "";

      row.appendChild(name);
      row.appendChild(time);

      var bottom = document.createElement("div");
      bottom.className = "row";

      var preview = document.createElement("div");
      preview.className = "preview";
      preview.textContent = last
        ? (last.from === "me" ? "You: " : "") + last.text
        : "No messages yet";

      bottom.appendChild(preview);
      if (unread > 0) {
        var badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = String(unread);
        bottom.appendChild(badge);
      }

      meta.appendChild(row);
      meta.appendChild(bottom);
      li.appendChild(avatar);
      li.appendChild(meta);

      function open() { openChat(chat.id); }
      li.addEventListener("click", open);
      li.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });

      el.chatList.appendChild(li);
    });
  }

  function bubbleFor(msg) {
    var div = document.createElement("div");
    div.className = "bubble " + (msg.from === "me" ? "out" : "in");
    div.appendChild(document.createTextNode(msg.text));

    var stamp = document.createElement("span");
    stamp.className = "stamp";
    stamp.appendChild(document.createTextNode(clockOf(msg.at)));

    if (msg.from === "me") {
      var ticks = document.createElement("span");
      ticks.className = "ticks";
      ticks.textContent = msg.read ? "✓✓" : "✓";
      ticks.title = msg.read ? "Read" : "Sent";
      stamp.appendChild(ticks);
    }

    div.appendChild(stamp);
    return div;
  }

  function renderMessages() {
    var chat = findChat(activeId);
    el.peerName.textContent = chat.name;
    el.peerStatus.textContent = chat.status;
    el.peerAvatar.textContent = chat.avatar;

    el.messages.innerHTML = "";
    var lastDay = null;

    thread(activeId).forEach(function (msg) {
      var day = dayLabelOf(msg.at);
      if (day !== lastDay) {
        var divider = document.createElement("div");
        divider.className = "day-divider";
        divider.textContent = day;
        el.messages.appendChild(divider);
        lastDay = day;
      }
      el.messages.appendChild(bubbleFor(msg));
    });

    showTyping();
    scrollToBottom();
  }

  function scrollToBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function showTyping() {
    hideTyping();
    if (!queueOf(activeId).typing) return;
    var wrap = document.createElement("div");
    wrap.className = "typing";
    wrap.id = "typing";
    wrap.setAttribute("aria-label", "Bot is typing");
    for (var i = 0; i < 3; i++) wrap.appendChild(document.createElement("span"));
    el.messages.appendChild(wrap);
    scrollToBottom();
  }

  function hideTyping() {
    var node = document.getElementById("typing");
    if (node) node.remove();
  }

  /* ---------------- actions ---------------- */

  function openChat(id) {
    activeId = id;
    state.unread[id] = 0;
    el.app.classList.add("chat-open");
    renderChatList();
    renderMessages();
    save();
    el.input.focus();
  }

  function push(chatId, msg) {
    thread(chatId).push(msg);
    if (msg.from === "them" && chatId !== activeId) {
      state.unread[chatId] = (state.unread[chatId] || 0) + 1;
    }
    save();
    renderChatList();
    if (chatId === activeId) renderMessages();
  }

  function markMineRead(chatId) {
    thread(chatId).forEach(function (m) {
      if (m.from === "me") m.read = true;
    });
  }

  function answerFor(chat, text) {
    if (chat.kind === "echo") return text;
    return window.Bot.reply(text);
  }

  /** Queues one reply behind any replies already in flight for this chat. */
  function scheduleReply(chatId, replyText) {
    var q = queueOf(chatId);
    var now = Date.now();
    var startAt = Math.max(now, q.freeAt);
    var fireAt = startAt + window.Bot.typingDelay(replyText);
    q.freeAt = fireAt;

    q.timers.push(setTimeout(function () {
      q.typing = true;
      if (chatId === activeId) showTyping();
    }, startAt - now));

    q.timers.push(setTimeout(function () {
      q.typing = q.freeAt > Date.now();
      if (chatId === activeId) hideTyping();
      markMineRead(chatId);
      push(chatId, { from: "them", text: replyText, at: Date.now(), read: true });
    }, fireAt - now));
  }

  function send(text) {
    text = text.trim();
    if (!text) return;

    var chat = findChat(activeId);
    push(chat.id, { from: "me", text: text, at: Date.now(), read: false });

    // "Notes" is a self-chat: nothing replies there.
    if (chat.kind === "notes") return;

    scheduleReply(chat.id, answerFor(chat, text));
  }

  function cancelQueue(chatId) {
    var q = queueOf(chatId);
    q.timers.forEach(clearTimeout);
    q.timers = [];
    q.freeAt = 0;
    q.typing = false;
  }

  function clearActive() {
    state.threads[activeId] = [];
    state.unread[activeId] = 0;
    cancelQueue(activeId);
    hideTyping();
    save();
    renderChatList();
    renderMessages();
  }

  /* ---------------- wiring ---------------- */

  el.composer.addEventListener("submit", function (e) {
    e.preventDefault();
    send(el.input.value);
    el.input.value = "";
    el.input.focus();
  });

  el.search.addEventListener("input", renderChatList);
  el.back.addEventListener("click", function () { el.app.classList.remove("chat-open"); });
  el.clear.addEventListener("click", clearActive);

  renderChatList();
  renderMessages();
  if (window.matchMedia("(min-width: 761px)").matches) {
    el.app.classList.add("chat-open");
    el.input.focus();
  }
})();
