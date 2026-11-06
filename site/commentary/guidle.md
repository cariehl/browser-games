# Commentary on GUIDle

My work team and I have gotten in the habit of playing [RNGdle](https://www.rngdle.com/) during our daily standups. I had joked about creating a version that uses GUIDs instead of random numbers. This is that version.

I originally tried to build this in Rust, and envisioned it as a command-line engine with a webassembly implementation. That turned out to be needlessly complex, and the entire project stalled as a result. It also used an older version of Claude Code, and looking back, I realize I was being a micromanager instead of letting Claude do the heavy lifting for me.

The current version was built with Claude Opus 5.5 via Claude Cowork. It did a pretty good job of capturing the spirit of RNGdle, but needed some prompting when it came to specifics of the game design, and especially animations - Claude seems to enjoy animations that are about 3x as fast as I can reasonably handle.

I had to workshop some of the other concepts too, like badge rarity and celebration styles. Still, it did a good enough job with the initial implementation that I was able to carry it through to the finish line.
