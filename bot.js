/**
 * Bot reply engine.
 *
 * Rules are checked in order; the first one whose `match` accepts the
 * incoming text wins. `reply` is either a string or a list of strings
 * (one is picked at random) so answers don't feel canned.
 */
(function (global) {
  "use strict";

  // Normalize for matching: lowercase, strip punctuation/emoji-ish tails,
  // collapse whitespace. "Hi!!!" and "  hi " both become "hi".
  function normalize(text) {
    return String(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Matches when any of the given phrases appears as a whole word/phrase.
  function contains() {
    var phrases = Array.prototype.slice.call(arguments);
    return function (norm) {
      return phrases.some(function (p) {
        return new RegExp("(^|\\s)" + p + "($|\\s)").test(norm);
      });
    };
  }

  function pick(value) {
    return Array.isArray(value)
      ? value[Math.floor(Math.random() * value.length)]
      : value;
  }

  var RULES = [
    {
      name: "greeting",
      match: contains("hi", "hii+", "hey", "heyy+", "hello", "helo", "yo", "hola", "salam", "good morning", "good evening", "good afternoon"),
      reply: ["hi", "hi 👋", "hi there!"]
    },
    {
      name: "how-are-you",
      match: contains("how are you", "how r u", "how are u", "hows it going", "how is it going", "whats up", "sup"),
      reply: ["I'm good, thanks for asking! How about you?", "Doing great 🙂 What about you?"]
    },
    {
      name: "identity",
      match: contains("who are you", "what are you", "your name", "whats your name"),
      reply: "I'm a demo bot living in this chat app. Say \"hi\" and I'll say hi back."
    },
    {
      name: "thanks",
      match: contains("thanks", "thank you", "thx", "ty", "shukran"),
      reply: ["Anytime! 🙌", "You're welcome!"]
    },
    {
      name: "time",
      match: contains("time", "what time is it"),
      reply: function () {
        return "It's " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " on your device.";
      }
    },
    {
      name: "help",
      match: contains("help", "commands", "what can you do"),
      reply: "Try: \"hi\", \"how are you\", \"who are you\", \"tell me a joke\", \"what time is it\", or \"bye\"."
    },
    {
      name: "joke",
      match: contains("joke", "tell me a joke", "make me laugh"),
      reply: [
        "Why do programmers prefer dark mode? Because light attracts bugs. 🐛",
        "There are only two hard things in programming: cache invalidation, naming things, and off-by-one errors."
      ]
    },
    {
      name: "love",
      match: contains("i love you", "love you"),
      reply: "That's sweet ❤️ I'm just a bot, but I appreciate it!"
    },
    {
      name: "farewell",
      match: contains("bye", "goodbye", "see you", "cya", "good night", "gn"),
      reply: ["Bye! 👋 Talk soon.", "See you later!"]
    }
  ];

  var FALLBACKS = [
    "I only know a few things so far — try saying \"hi\" or \"help\".",
    "Hmm, I didn't get that. Type \"help\" to see what I understand.",
    "Not sure about that one 🤔 Say \"hi\" to start over."
  ];

  /**
   * Returns the bot's reply text for a user message.
   * @param {string} text raw user input
   * @returns {string}
   */
  function reply(text) {
    var norm = normalize(text);
    if (!norm) return pick(FALLBACKS);

    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i].match(norm)) {
        var r = RULES[i].reply;
        return typeof r === "function" ? r(norm) : pick(r);
      }
    }
    return pick(FALLBACKS);
  }

  /** Rough "thinking" delay so replies feel typed, not instant. */
  function typingDelay(text) {
    return Math.min(1600, 350 + String(text).length * 28);
  }

  global.Bot = { reply: reply, typingDelay: typingDelay, normalize: normalize, rules: RULES };
})(typeof window !== "undefined" ? window : globalThis);

if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof window !== "undefined" ? window : globalThis).Bot;
}
