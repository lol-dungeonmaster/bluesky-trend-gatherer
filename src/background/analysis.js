import { state } from './state.js';
import { fetchWithAuth } from './auth.js';

export async function analyzeTopActorThread(topicQuery, actorDid) {
  try {
    console.log(`[${new Date().toISOString()}] [Analysis] Starting thread analysis for topic: "${topicQuery}", actor: ${actorDid}`);

    // Step 1: Find the exact post using Advanced Search syntax
    let query = encodeURIComponent(`${topicQuery} from:${actorDid}`);
    let searchUrl = `https://bsky.social/xrpc/app.bsky.feed.searchPosts?q=${query}&limit=1`;
    let searchData = await fetchWithAuth(searchUrl);
    let postUri = null;
    let postText = "";
    if (!searchData.posts || searchData.posts.length === 0) {
      console.warn(`[${new Date().toISOString()}] [Analysis] Search query missed exact phrase. Falling back to getAuthorFeed for actor ${actorDid}`);
      let authorFeedUrl = `https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed?actor=${actorDid}&limit=1`;
      let authorData = await fetchWithAuth(authorFeedUrl);
      if (authorData && authorData.feed && authorData.feed.length > 0) {
        postUri = authorData.feed[0].post.uri;
        postText = authorData.feed[0].post.record.text;
      } else {
        console.warn(`[${new Date().toISOString()}] [Analysis] Failure: No posts found for actor ${actorDid}`);
        return null;
      }
    } else {
      postUri = searchData.posts[0].uri;
      postText = searchData.posts[0].record.text;
    }

    // Snippet the text to 60 characters for clean logging
    let snippet = postText.replace(/\n/g, ' ');
    if (snippet.length > 60) snippet = snippet.substring(0, 60) + "...";
    console.log(`[${new Date().toISOString()}] [Analysis] Success: Found post (${postUri})`);
    console.log(`[${new Date().toISOString()}] [Analysis] Post Content: "${snippet}"`);

    // Step 2: Pull the full thread (comments/replies) for that post
    let threadUrl = `https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(postUri)}`;
    let threadData = await fetchWithAuth(threadUrl);
    if (threadData && threadData.thread) {
      let replyCount = threadData.thread.replies ? threadData.thread.replies.length : 0;
      console.log(`[${new Date().toISOString()}] [Analysis] Success: Pulled thread with ${replyCount} top-level replies.`);
      return threadData.thread;
    } else {
      console.warn(`[${new Date().toISOString()}] [Analysis] Failure: Thread data malformed or empty.`);
      return null;
    }
  } catch (err) {
    if (err.message.includes("[Auth] Warning:")) {
      console.warn(`[${new Date().toISOString()}] ${err.message}`);
    } else {
      console.error(`[${new Date().toISOString()}] [Analysis] Fatal Error during thread analysis:`, err);
    }
    return null;
  }
}
