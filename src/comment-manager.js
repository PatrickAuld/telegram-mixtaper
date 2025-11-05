/**
 * Comment Manager using Cloudflare KV Storage
 * Manages single-use comments that are added to bot responses
 */

export class CommentManager {
  constructor(env) {
    this.env = env;
    this.kv = env.BOT_COMMENTS;
  }

  /**
   * Add a new comment to the database
   * @param {string} text - The comment text
   * @param {string} addedBy - User ID who added the comment
   * @returns {Promise<object>} The created comment object
   */
  async addComment(text, addedBy) {
    try {
      // Generate unique ID
      const id = crypto.randomUUID();
      const comment = {
        id,
        text,
        used: false,
        addedBy,
        addedAt: new Date().toISOString()
      };

      // Store comment by ID
      await this.kv.put(`comment:${id}`, JSON.stringify(comment));

      // Add to unused comments list
      await this.addToUnusedList(id);

      console.log(`Added new comment: ${id}`);
      return comment;

    } catch (error) {
      console.error('Error adding comment:', error);
      throw error;
    }
  }

  /**
   * Get a random unused comment and mark it as used
   * @returns {Promise<object|null>} The comment object or null if none available
   */
  async getAndUseComment() {
    try {
      // Get list of unused comment IDs
      const unusedIds = await this.getUnusedList();

      if (unusedIds.length === 0) {
        console.log('No unused comments available');
        return null;
      }

      // Pick random comment
      const randomIndex = Math.floor(Math.random() * unusedIds.length);
      const commentId = unusedIds[randomIndex];

      // Get the comment
      const commentData = await this.kv.get(`comment:${commentId}`, 'json');

      if (!commentData) {
        console.warn(`Comment ${commentId} not found, removing from list`);
        await this.removeFromUnusedList(commentId);
        return null;
      }

      // Mark as used
      commentData.used = true;
      commentData.usedAt = new Date().toISOString();
      await this.kv.put(`comment:${commentId}`, JSON.stringify(commentData));

      // Remove from unused list
      await this.removeFromUnusedList(commentId);

      console.log(`Used comment: ${commentId}`);
      return commentData;

    } catch (error) {
      console.error('Error getting unused comment:', error);
      return null;
    }
  }

  /**
   * Get list of unused comment IDs
   * @returns {Promise<string[]>}
   */
  async getUnusedList() {
    try {
      const listData = await this.kv.get('unused_comments', 'json');
      return listData || [];
    } catch (error) {
      console.error('Error getting unused list:', error);
      return [];
    }
  }

  /**
   * Add comment ID to unused list
   * @param {string} commentId
   */
  async addToUnusedList(commentId) {
    try {
      const unusedIds = await this.getUnusedList();
      if (!unusedIds.includes(commentId)) {
        unusedIds.push(commentId);
        await this.kv.put('unused_comments', JSON.stringify(unusedIds));
      }
    } catch (error) {
      console.error('Error adding to unused list:', error);
      throw error;
    }
  }

  /**
   * Remove comment ID from unused list
   * @param {string} commentId
   */
  async removeFromUnusedList(commentId) {
    try {
      const unusedIds = await this.getUnusedList();
      const filteredIds = unusedIds.filter(id => id !== commentId);
      await this.kv.put('unused_comments', JSON.stringify(filteredIds));
    } catch (error) {
      console.error('Error removing from unused list:', error);
      throw error;
    }
  }

  /**
   * Get statistics about comments
   * @returns {Promise<object>}
   */
  async getStats() {
    try {
      const unusedIds = await this.getUnusedList();

      // Count total comments (this is a simplification - in production you'd want a counter)
      let totalCount = 0;
      let usedCount = 0;

      // List all comments (limited approach, for better scaling use metadata)
      const list = await this.kv.list({ prefix: 'comment:' });
      totalCount = list.keys.length;
      usedCount = totalCount - unusedIds.length;

      return {
        total: totalCount,
        unused: unusedIds.length,
        used: usedCount
      };
    } catch (error) {
      console.error('Error getting stats:', error);
      return { total: 0, unused: 0, used: 0 };
    }
  }

  /**
   * Check if a comment should be added based on probability
   * @param {number} probability - Value between 0 and 1
   * @returns {boolean}
   */
  shouldAddComment(probability) {
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return Math.random() < probability;
  }
}
