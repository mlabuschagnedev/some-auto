import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { deletePostRecord, loadPosts, updateLinkedInManualPost } from "../api";
import type { PostRecord, SessionPayload } from "../types";
import { EmptyState, SectionCard, StatusPill } from "./ui";

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not set";
  }
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function postTone(status: string): "neutral" | "good" | "warn" | "bad" {
  if (status === "posted") {
    return "good";
  }
  if (status === "failed") {
    return "bad";
  }
  if (status === "manual_pending" || status === "posting") {
    return "warn";
  }
  return "neutral";
}

export function PostsTab(props: {
  mode: "scheduled" | "posted";
  initialPosts: PostRecord[];
  session: SessionPayload;
  onSessionUpdate: (nextSession: SessionPayload | null) => void;
  canManage: boolean;
  canManualLinkedIn: boolean;
  onWorkspaceChanged: () => Promise<void> | void;
  onNotice: (message: string, tone?: "success" | "error") => void;
}) {
  const [posts, setPosts] = useState<PostRecord[]>(props.initialPosts);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    setPosts(props.initialPosts);
  }, [props.initialPosts]);

  async function refreshPosts(): Promise<void> {
    setLoading(true);
    try {
      const items = await loadPosts(props.session, props.onSessionUpdate);
      setPosts(items);
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : "Unable to load posts.", "error");
    } finally {
      setLoading(false);
    }
  }

  const filteredPosts = useMemo(() => {
    const eligible =
      props.mode === "scheduled"
        ? posts.filter((post) =>
            ["draft", "scheduled", "posting", "manual_pending"].includes(post.status),
          )
        : posts.filter((post) => ["posted", "failed"].includes(post.status));

    const query = deferredSearch.trim().toLowerCase();
    if (!query) {
      return eligible;
    }
    return eligible.filter((post) => {
      const haystack = `${post.page_name || ""} ${post.content || ""} ${post.platforms.join(" ")}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [deferredSearch, posts, props.mode]);

  async function handleDelete(post: PostRecord): Promise<void> {
    if (!window.confirm(`Delete post #${post.id}?`)) {
      return;
    }
    try {
      await deletePostRecord(props.session, props.onSessionUpdate, post.id);
      props.onNotice("Post deleted.", "success");
      await refreshPosts();
      await props.onWorkspaceChanged();
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : "Unable to delete the post.", "error");
    }
  }

  async function handleLinkedInManual(post: PostRecord, done: boolean): Promise<void> {
    try {
      const postUrl = done
        ? window.prompt("LinkedIn post URL (optional)", post.linkedin_manual.page_url || "") || ""
        : "";
      await updateLinkedInManualPost(props.session, props.onSessionUpdate, post.id, {
        done,
        post_url: postUrl || undefined,
      });
      props.onNotice(
        done ? "LinkedIn manual completion recorded." : "LinkedIn manual completion cleared.",
        "success",
      );
      await refreshPosts();
      await props.onWorkspaceChanged();
    } catch (error) {
      props.onNotice(
        error instanceof Error ? error.message : "Unable to update LinkedIn manual state.",
        "error",
      );
    }
  }

  return (
    <div className="view-grid">
      <SectionCard
        title={props.mode === "scheduled" ? "Scheduled queue" : "Posted history"}
        subtitle={
          props.mode === "scheduled"
            ? "Posts awaiting publish, processing, or waiting on LinkedIn manual completion."
            : "Posted and failed history from the live posting pipeline."
        }
        actions={
          <button className="secondary-button" onClick={() => void refreshPosts()} type="button">
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        }
      >
        <div className="toolbar">
          <input
            className="search-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search page, content, or platform"
            value={search}
          />
          <p>{filteredPosts.length} posts shown</p>
        </div>

        {!filteredPosts.length ? (
          <EmptyState
            text={
              props.mode === "scheduled"
                ? "No queued posts match this filter."
                : "No history posts match this filter."
            }
          />
        ) : (
          <div className="post-grid">
            {filteredPosts.map((post) => {
              const canDelete =
                props.canManage &&
                (props.mode === "posted"
                  ? ["posted", "failed"].includes(post.status)
                  : ["draft", "scheduled"].includes(post.status));

              return (
                <article className="post-card" key={post.id}>
                  <div className="post-card-header">
                    <div>
                      <h3>
                        #{post.id} - {post.page_name || "Unknown page"}
                      </h3>
                      <p>{post.platforms.join(", ") || "No platforms"}</p>
                    </div>
                    <StatusPill label={post.status} tone={postTone(post.status)} />
                  </div>
                  <div className="post-card-body">
                    <p className="post-copy">{post.content || "No content"}</p>
                    <div className="post-meta-grid">
                      <div>
                        <span className="detail-label">Scheduled</span>
                        <strong>{formatDateTime(post.scheduled_time)}</strong>
                      </div>
                      <div>
                        <span className="detail-label">Posted</span>
                        <strong>{formatDateTime(post.posted_at)}</strong>
                      </div>
                      <div>
                        <span className="detail-label">Media</span>
                        <strong>{post.media_paths.length}</strong>
                      </div>
                    </div>
                    {post.error_message ? <p className="inline-error">{post.error_message}</p> : null}
                    {Object.keys(post.platform_urls).length ? (
                      <div className="platform-links">
                        {Object.entries(post.platform_urls).map(([platform, url]) => (
                          <a href={url} key={platform} rel="noreferrer" target="_blank">
                            {platform}
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {post.linkedin_manual.required ? (
                      <div className="linkedin-manual-box">
                        <div>
                          <p className="detail-label">LinkedIn manual assist</p>
                          <strong>
                            {post.linkedin_manual.done ? "Completed" : "Pending"}
                          </strong>
                        </div>
                        {props.canManualLinkedIn ? (
                          <div className="inline-actions">
                            {post.linkedin_manual.done ? (
                              <button
                                className="secondary-button"
                                onClick={() => void handleLinkedInManual(post, false)}
                                type="button"
                              >
                                Reopen
                              </button>
                            ) : (
                              <button
                                className="primary-button"
                                onClick={() => void handleLinkedInManual(post, true)}
                                type="button"
                              >
                                Mark done
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {canDelete ? (
                    <div className="inline-actions">
                      <button
                        className="danger-button"
                        onClick={() => void handleDelete(post)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
