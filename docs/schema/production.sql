-- Production database structure, as recorded by `npm run schema:snapshot`.
--
-- THIS FILE IS A RECORD, NOT SOMETHING TO RUN. Nothing applies it, and
-- applying it to production would be destructive. It exists so that the
-- question "what does production actually look like?" has one answer that
-- lives in the repo, and so `npm run schema:check` can tell you when the
-- real thing has moved away from it.
--
-- Schema changes still ship the way DOCTRINE §6.5 and §7 describe: a file
-- in docs/SQL, handed to the operator as a GitHub URL, applied by hand.
-- After applying one, re-run `npm run schema:snapshot` and record it in
-- docs/MIGRATIONS_APPLIED.md, so this file and reality stay together.
--
-- PostgreSQL database dump
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA "public";

--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA "public" IS 'standard public schema';

--
-- Name: match_training_corpus("public"."vector", double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."match_training_corpus"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer) RETURNS TABLE("id" "uuid", "title" "text", "source_type" "text", "category" "text", "content_text" "text", "metadata" "jsonb", "similarity" double precision)
    LANGUAGE "sql" STABLE
    AS $$
  SELECT
    training_corpus.id,
    training_corpus.title,
    training_corpus.source_type,
    training_corpus.category,
    training_corpus.content_text,
    training_corpus.metadata,
    1 - (training_corpus.embedding <=> query_embedding) AS similarity
  FROM training_corpus
  WHERE 1 - (training_corpus.embedding <=> query_embedding) > match_threshold
  ORDER BY training_corpus.embedding <=> query_embedding
  LIMIT match_count;
$$;

--
-- Name: set_assets_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_assets_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_blog_categories_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_blog_categories_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_blog_posts_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_blog_posts_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_builder_email_templates_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_builder_email_templates_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_builder_forms_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_builder_forms_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_builder_landing_page_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_builder_landing_page_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_builder_module_classes_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_builder_module_classes_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_builder_modules_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_builder_modules_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_builder_page_templates_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_builder_page_templates_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_builder_products_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_builder_products_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_builder_saved_sections_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_builder_saved_sections_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_contact_personas_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_contact_personas_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_content_items_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_content_items_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_develop_themes_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_develop_themes_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_articles_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_articles_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_comments_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_comments_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_content_items_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_content_items_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_content_types_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_content_types_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_ctas_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_ctas_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_descriptions_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_descriptions_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_ebooks_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_ebooks_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_emails_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_emails_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_formats_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_formats_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_hashtags_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_hashtags_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_headline_categories_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_headline_categories_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_headlines_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_headlines_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_keywords_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_keywords_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_pitches_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_pitches_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_posts_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_posts_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_prompts_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_prompts_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_reports_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_reports_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_subheadings_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_subheadings_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_subject_lines_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_subject_lines_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_taglines_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_taglines_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_tags_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_tags_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_topics_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_topics_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_transcripts_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_transcripts_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_tweets_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_tweets_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_white_papers_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_white_papers_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_messaging_wyr_questions_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_messaging_wyr_questions_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_project_admin_users_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_project_admin_users_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_updated_at_now(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_updated_at_now"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: set_updated_at_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_updated_at_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

--
-- Name: set_website_peers_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_website_peers_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

--
-- Name: update_assets_video_curation_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."update_assets_video_curation_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: acquire_job_mirror; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."acquire_job_mirror" (
    "project_id" "text" NOT NULL,
    "id" "text" NOT NULL,
    "owner_user_id" "text",
    "stage" "text" DEFAULT ''::"text" NOT NULL,
    "workspace_id" "text" DEFAULT ''::"text" NOT NULL,
    "type" "text" DEFAULT ''::"text" NOT NULL,
    "url" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: acquire_youtube_comment_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."acquire_youtube_comment_records" (
    "comment_id" "text" NOT NULL,
    "video_id" "text" DEFAULT ''::"text" NOT NULL,
    "video_url" "text" DEFAULT ''::"text" NOT NULL,
    "author_name" "text" DEFAULT ''::"text" NOT NULL,
    "author_url" "text" DEFAULT ''::"text" NOT NULL,
    "text" "text" DEFAULT ''::"text" NOT NULL,
    "like_count" integer DEFAULT 0 NOT NULL,
    "reply_count" integer DEFAULT 0 NOT NULL,
    "published_at" timestamp with time zone,
    "score" integer DEFAULT 0 NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "category" "text" DEFAULT ''::"text" NOT NULL,
    "approach" "text" DEFAULT ''::"text" NOT NULL,
    "attributes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "campaign_id" "text",
    "run_id" "text" DEFAULT ''::"text" NOT NULL,
    "contact_id" "text",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: acquire_youtube_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."acquire_youtube_comments" (
    "run_id" "text" NOT NULL,
    "video_url" "text" NOT NULL,
    "video_id" "text" DEFAULT ''::"text" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "channel_name" "text" DEFAULT ''::"text" NOT NULL,
    "comment_count" integer DEFAULT 0 NOT NULL,
    "request_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "result_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: acquire_youtube_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."acquire_youtube_details" (
    "run_id" "text" NOT NULL,
    "video_url" "text" NOT NULL,
    "video_id" "text" DEFAULT ''::"text" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "channel_name" "text" DEFAULT ''::"text" NOT NULL,
    "transcript_status" "text" DEFAULT 'unavailable'::"text" NOT NULL,
    "transcript_source" "text" DEFAULT 'none'::"text" NOT NULL,
    "transcript_provider" "text" DEFAULT 'youtube-native'::"text" NOT NULL,
    "request_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "result_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "tags" "text"
);

--
-- Name: acquire_youtube_topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."acquire_youtube_topics" (
    "id" bigint NOT NULL,
    "topic" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: acquire_youtube_videos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."acquire_youtube_videos" (
    "video_record_id" "text" NOT NULL,
    "video_url" "text",
    "video_id" "text",
    "title" "text",
    "channel_name" "text",
    "channel_url" "text",
    "description" "text",
    "hashtags" "text",
    "topic" "text",
    "tags" "text",
    "thumbnail_url" "text",
    "transcript_status" "text" DEFAULT 'unavailable'::"text",
    "transcript_source" "text" DEFAULT 'none'::"text",
    "transcript_provider" "text" DEFAULT 'youtube-native'::"text",
    "detail_run_id" "text",
    "comment_run_id" "text",
    "miner_run_id" "text",
    "research_run_id" "text",
    "comment_count" numeric DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "media_status" "text" DEFAULT 'none'::"text" NOT NULL,
    "media_job_id" "text" DEFAULT ''::"text" NOT NULL,
    "media_mp4_url" "text" DEFAULT ''::"text" NOT NULL,
    "media_mp3_url" "text" DEFAULT ''::"text" NOT NULL,
    "media_error" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "acquire_youtube_videos_media_status_check" CHECK (("media_status" = ANY (ARRAY['none'::"text", 'queued'::"text", 'running'::"text", 'done'::"text", 'failed'::"text"])))
);

--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."activity_log" (
    "id" bigint NOT NULL,
    "actor" "text" DEFAULT 'system'::"text" NOT NULL,
    "action" "text" NOT NULL,
    "entity_type" "text",
    "entity_id" "text",
    "summary" "text" NOT NULL,
    "meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: activity_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."activity_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: activity_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."activity_log_id_seq" OWNED BY "public"."activity_log"."id";

--
-- Name: agent_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."agent_messages" (
    "id" bigint NOT NULL,
    "project_id" bigint,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "session_id" bigint NOT NULL,
    "attachment_url" "text",
    "attachment_mime" "text",
    "attachment_name" "text",
    "status" "text" DEFAULT 'complete'::"text" NOT NULL,
    "error_details" "text",
    "parent_id" bigint
);

--
-- Name: TABLE "agent_messages"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."agent_messages" IS 'Tri-Agent Discussion log for App Users, Roger Thorson, and Antigravity';

--
-- Name: COLUMN "agent_messages"."parent_id"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."agent_messages"."parent_id" IS 'Used for telescoping threads';

--
-- Name: app_auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."app_auth_sessions" (
    "token" "text" NOT NULL,
    "user_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "active_project_id" "text"
);

--
-- Name: COLUMN "app_auth_sessions"."active_project_id"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."app_auth_sessions"."active_project_id" IS 'User-selected workspace for this session; validated against app_project_memberships on write.';

--
-- Name: app_auth_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."app_auth_users" (
    "id" "text" NOT NULL,
    "email" "text" NOT NULL,
    "name" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "role" "text" DEFAULT 'user'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: app_credential_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."app_credential_identities" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "identity_label" "text",
    "identity_id" "text",
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_verified_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: app_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."app_invitations" (
    "id" "text" NOT NULL,
    "email" "text" NOT NULL,
    "project_id" "text",
    "project_role" "text" DEFAULT 'member'::"text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "invited_by_user_id" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    "accepted_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "app_invitations_project_role_check" CHECK (("project_role" = ANY (ARRAY['owner'::"text", 'member'::"text"]))),
    CONSTRAINT "app_invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'expired'::"text", 'revoked'::"text"])))
);

--
-- Name: app_project_admin_password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."app_project_admin_password_resets" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "admin_user_id" "text" NOT NULL,
    "email" "text" NOT NULL,
    "code_hash" "text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone
);

--
-- Name: app_project_admin_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."app_project_admin_sessions" (
    "token" "text" NOT NULL,
    "admin_user_id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
);

--
-- Name: app_project_admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."app_project_admin_users" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "email" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "role" "text" DEFAULT 'editor'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: app_project_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."app_project_memberships" (
    "project_id" "text" NOT NULL,
    "user_id" "text" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: app_project_support_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."app_project_support_requests" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "admin_user_id" "text",
    "admin_email" "text" DEFAULT ''::"text" NOT NULL,
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "screenshot_url" "text" DEFAULT ''::"text" NOT NULL,
    "screenshot_name" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "app_project_support_requests_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'urgent'::"text"]))),
    CONSTRAINT "app_project_support_requests_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_progress'::"text", 'resolved'::"text", 'closed'::"text"])))
);

--
-- Name: app_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."app_projects" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "created_by_user_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "project_url" "text" DEFAULT ''::"text" NOT NULL,
    "website" "text" DEFAULT ''::"text" NOT NULL,
    "logo_data_url" "text" DEFAULT ''::"text" NOT NULL,
    "enabled_modules" "jsonb" DEFAULT '{"crm": true}'::"jsonb" NOT NULL,
    "domain" "text" DEFAULT ''::"text" NOT NULL,
    "favicon_data_url" "text" DEFAULT ''::"text" NOT NULL,
    "site_settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

--
-- Name: COLUMN "app_projects"."timezone"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."app_projects"."timezone" IS 'IANA timezone for interpreting scheduled local times (e.g. America/Los_Angeles).';

--
-- Name: COLUMN "app_projects"."project_url"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."app_projects"."project_url" IS 'Required project-level default URL for campaigns and social posts.';

--
-- Name: COLUMN "app_projects"."website"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."app_projects"."website" IS 'Compatibility alias for the project default URL.';

--
-- Name: COLUMN "app_projects"."logo_data_url"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."app_projects"."logo_data_url" IS 'Project logo (data URL or https URL). Visible to all project members.';

--
-- Name: COLUMN "app_projects"."domain"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."app_projects"."domain" IS 'Public site hostname (e.g. benvin.org). Empty = no custom domain. Unique when set.';

--
-- Name: COLUMN "app_projects"."favicon_data_url"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."app_projects"."favicon_data_url" IS 'Project favicon (data URL or https URL). Used for browser tab icon when this project is active.';

--
-- Name: app_site_import_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."app_site_import_assets" (
    "id" "text" NOT NULL,
    "job_id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "original_url" "text" NOT NULL,
    "storage_url" "text" DEFAULT ''::"text" NOT NULL,
    "content_hash" "text" DEFAULT ''::"text" NOT NULL,
    "mime_type" "text" DEFAULT ''::"text" NOT NULL,
    "byte_size" bigint DEFAULT 0 NOT NULL,
    "width" integer,
    "height" integer,
    "alt_text" "text" DEFAULT ''::"text" NOT NULL,
    "referenced_by" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "app_site_import_assets_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'downloaded'::"text", 'failed'::"text", 'skipped_cap'::"text"])))
);

--
-- Name: app_site_import_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."app_site_import_jobs" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "owner_user_id" "text",
    "source_url" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "claimed_at" timestamp with time zone,
    "claimed_by" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "client_authorization" "text",
    "checkpoints" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "coverage" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "cost" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "caps" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "app_site_import_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'capturing'::"text", 'normalizing'::"text", 'extracting'::"text", 'complete'::"text", 'failed'::"text"])))
);

--
-- Name: asset_associations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."asset_associations" (
    "id" bigint NOT NULL,
    "asset_id" bigint NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "target_label" "text" DEFAULT ''::"text" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: asset_associations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."asset_associations" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."asset_associations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: asset_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."asset_categories" (
    "id" bigint NOT NULL,
    "asset_type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "parent_category_id" bigint,
    CONSTRAINT "asset_categories_asset_type_check" CHECK (("asset_type" = ANY (ARRAY['Image'::"text", 'Video'::"text", 'Audio'::"text", 'Lead Magnet'::"text", 'File'::"text"])))
);

--
-- Name: asset_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."asset_categories" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."asset_categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: assets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."assets_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."assets" (
    "asset_name" "text" NOT NULL,
    "asset_type" "text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "location" "text" DEFAULT ''::"text" NOT NULL,
    "size" bigint DEFAULT 0 NOT NULL,
    "image_width" integer,
    "image_height" integer,
    "id" bigint DEFAULT "nextval"('"public"."assets_id_seq"'::"regclass") NOT NULL,
    "category" "text" DEFAULT ''::"text" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "topic" "text" DEFAULT ''::"text",
    "comments" "text" DEFAULT ''::"text",
    "generation_status" "text",
    "generation_job_id" "text",
    "thumbnail_location" "text" DEFAULT ''::"text" NOT NULL,
    "thumbnail_width" integer,
    "thumbnail_height" integer,
    "thumbnail_size" bigint,
    "thumbnail_generated_at" timestamp with time zone,
    "aspect" "text" DEFAULT 'square'::"text" NOT NULL,
    "caption" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "renditions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "renditions_generated_at" timestamp with time zone,
    CONSTRAINT "assets_aspect_check" CHECK (("aspect" = ANY (ARRAY['wide'::"text", 'square'::"text", 'tall'::"text"]))),
    CONSTRAINT "assets_asset_type_check" CHECK (("asset_type" = ANY (ARRAY['Image'::"text", 'Video'::"text", 'Audio'::"text", 'Lead Magnet'::"text", 'File'::"text"])))
);

--
-- Name: COLUMN "assets"."generation_status"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."assets"."generation_status" IS 'Asynchronous AI tracking state: queued, processing, completed, failed';

--
-- Name: COLUMN "assets"."generation_job_id"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."assets"."generation_job_id" IS 'Platform-specific (Veo/Google) Job identifier for pulling external outputs';

--
-- Name: COLUMN "assets"."caption"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."assets"."caption" IS 'Display caption for Image assets; preferred source for Image → Headline import';

--
-- Name: assets_video_curation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."assets_video_curation" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "video_id" "text" NOT NULL,
    "video_url" "text" NOT NULL,
    "title" "text",
    "thumbnail_url" "text",
    "topic" "text",
    "tags" "text",
    "score" integer DEFAULT 0,
    "visuals_liked" "jsonb" DEFAULT '[]'::"jsonb",
    "specific_clips" "jsonb" DEFAULT '[]'::"jsonb",
    "search_context" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "positive_feedback" "text",
    "negative_feedback" "text"
);

--
-- Name: blog_card_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."blog_card_template" (
    "project_id" "text" NOT NULL,
    "template" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: blog_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."blog_categories" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "owner_user_id" "text",
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "slug" "text" DEFAULT ''::"text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "color" "text" DEFAULT ''::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: blog_post_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."blog_post_categories" (
    "post_id" "text" NOT NULL,
    "category_id" "text" NOT NULL
);

--
-- Name: blog_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."blog_posts" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "owner_user_id" "text",
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "slug" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "author" "text" DEFAULT ''::"text" NOT NULL,
    "author_user_id" "text",
    "featured_image_url" "text" DEFAULT ''::"text" NOT NULL,
    "featured_image_asset_id" "text",
    "excerpt" "text" DEFAULT ''::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "seo_title" "text" DEFAULT ''::"text" NOT NULL,
    "seo_description" "text" DEFAULT ''::"text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "reading_time_minutes" integer,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: builder_clusters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_clusters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_private" boolean DEFAULT false NOT NULL
);

--
-- Name: builder_email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_email_templates" (
    "id" bigint NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "summary" "text" DEFAULT ''::"text" NOT NULL,
    "subject" "text" DEFAULT ''::"text" NOT NULL,
    "heading" "text" DEFAULT ''::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "cta" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "blocks" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "template_kind" "text" DEFAULT 'text'::"text" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text"
);

--
-- Name: builder_extensions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_extensions" (
    "id" bigint NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "extension_type" "text" DEFAULT 'custom'::"text" NOT NULL,
    "parent_id" bigint,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "tags" "text" DEFAULT ''::"text" NOT NULL,
    "summary" "text" DEFAULT ''::"text" NOT NULL,
    "definition" "text" DEFAULT ''::"text" NOT NULL,
    "launch_page_id" "text" DEFAULT ''::"text" NOT NULL,
    "is_featured" boolean DEFAULT false NOT NULL,
    "usage_count" integer DEFAULT 0 NOT NULL,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "project_id" "text",
    "owner_user_id" "text"
);

--
-- Name: builder_extensions_manager; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_extensions_manager" (
    "id" bigint NOT NULL,
    "manager_key" "text" DEFAULT 'default'::"text" NOT NULL,
    "default_filters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "default_sort_key" "text" DEFAULT 'updatedAt'::"text" NOT NULL,
    "default_sort_dir" "text" DEFAULT 'desc'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "project_id" "text",
    "owner_user_id" "text"
);

--
-- Name: builder_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_forms" (
    "id" "text" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "form_type" "text" DEFAULT ''::"text" NOT NULL,
    "contact_type" "text" DEFAULT 'lead'::"text" NOT NULL,
    "lead_magnet_type" "text" DEFAULT ''::"text" NOT NULL,
    "lead_magnet_id" "text" DEFAULT ''::"text" NOT NULL,
    "cta_id" "text" DEFAULT ''::"text" NOT NULL,
    "heading" "text" DEFAULT ''::"text" NOT NULL,
    "submit_label" "text" DEFAULT ''::"text" NOT NULL,
    "success_message" "text" DEFAULT ''::"text" NOT NULL,
    "error_message" "text" DEFAULT ''::"text" NOT NULL,
    "accent_color" "text" DEFAULT ''::"text" NOT NULL,
    "match_landing_color" boolean DEFAULT false NOT NULL,
    "landing_color_mode" "text" DEFAULT ''::"text" NOT NULL,
    "use_landing_background" boolean DEFAULT false NOT NULL,
    "fields" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: builder_icons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_icons" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "owner_user_id" "text",
    "workspace_id" "text" DEFAULT ''::"text" NOT NULL,
    "object_type" "text" DEFAULT 'custom'::"text" NOT NULL,
    "object_name" "text" DEFAULT ''::"text" NOT NULL,
    "category" "text" DEFAULT ''::"text" NOT NULL,
    "summary" "text" DEFAULT ''::"text" NOT NULL,
    "visual_style" "text" DEFAULT ''::"text" NOT NULL,
    "palette" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "size_label" "text" DEFAULT ''::"text" NOT NULL,
    "svg" "text" DEFAULT ''::"text" NOT NULL,
    "data_url" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: builder_landing_page; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_landing_page" (
    "id" bigint NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "template_id" "text" DEFAULT ''::"text" NOT NULL,
    "primary_color" "text" DEFAULT ''::"text" NOT NULL,
    "background_color" "text" DEFAULT ''::"text" NOT NULL,
    "accent_color" "text" DEFAULT ''::"text" NOT NULL,
    "form_id" "text" DEFAULT ''::"text" NOT NULL,
    "lead_magnet_id" "text" DEFAULT ''::"text" NOT NULL,
    "headline_id" "text" DEFAULT ''::"text" NOT NULL,
    "pitch_id" "text" DEFAULT ''::"text" NOT NULL,
    "cta_id" "text" DEFAULT ''::"text" NOT NULL,
    "website_banner_image_id" "text" DEFAULT ''::"text" NOT NULL,
    "background_image_id" "text" DEFAULT ''::"text" NOT NULL,
    "feature_image_id" "text" DEFAULT ''::"text" NOT NULL,
    "logo_wide_id" "text" DEFAULT ''::"text" NOT NULL,
    "logo_square_id" "text" DEFAULT ''::"text" NOT NULL,
    "content_overrides" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "highlight_image_id" "text" DEFAULT ''::"text" NOT NULL,
    "feature_headline_id" "text" DEFAULT ''::"text" NOT NULL,
    "feature_subheading_id" "text" DEFAULT ''::"text" NOT NULL,
    "feature_title" "text" DEFAULT ''::"text" NOT NULL,
    "feature_copy" "text" DEFAULT ''::"text" NOT NULL,
    "highlight_headline_id" "text" DEFAULT ''::"text" NOT NULL,
    "highlight_pitch_id" "text" DEFAULT ''::"text" NOT NULL,
    "highlight_title" "text" DEFAULT ''::"text" NOT NULL,
    "highlight_copy" "text" DEFAULT ''::"text" NOT NULL,
    "body_headline_id" "text" DEFAULT ''::"text" NOT NULL,
    "body_subheading_id" "text" DEFAULT ''::"text" NOT NULL,
    "body_pitch_id" "text" DEFAULT ''::"text" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "template_kind" "text" DEFAULT 'fixed'::"text" NOT NULL,
    "layout_sections" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "slug" "text",
    "is_published" boolean DEFAULT true,
    "theme_id" "text",
    "is_private" boolean DEFAULT false NOT NULL,
    "search_priority" "text",
    "page_template_id" "text"
);

--
-- Name: COLUMN "builder_landing_page"."search_priority"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."builder_landing_page"."search_priority" IS 'Site Search ranking: pinned | boosted | normal | lowered | hidden. NULL = normal.';

--
-- Name: COLUMN "builder_landing_page"."page_template_id"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."builder_landing_page"."page_template_id" IS 'Which builder_page_templates row this page was built from. NULL/empty = no page template, which is a valid state. Distinct from template_id, which is a legacy layout name.';

--
-- Name: builder_landing_page_marinoff_bak_20260717; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_landing_page_marinoff_bak_20260717" (
    "id" bigint,
    "name" "text",
    "template_id" "text",
    "primary_color" "text",
    "background_color" "text",
    "accent_color" "text",
    "form_id" "text",
    "lead_magnet_id" "text",
    "headline_id" "text",
    "pitch_id" "text",
    "cta_id" "text",
    "website_banner_image_id" "text",
    "background_image_id" "text",
    "feature_image_id" "text",
    "logo_wide_id" "text",
    "logo_square_id" "text",
    "content_overrides" "jsonb",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "highlight_image_id" "text",
    "feature_headline_id" "text",
    "feature_subheading_id" "text",
    "feature_title" "text",
    "feature_copy" "text",
    "highlight_headline_id" "text",
    "highlight_pitch_id" "text",
    "highlight_title" "text",
    "highlight_copy" "text",
    "body_headline_id" "text",
    "body_subheading_id" "text",
    "body_pitch_id" "text",
    "project_id" "text",
    "owner_user_id" "text",
    "template_kind" "text",
    "layout_sections" "jsonb",
    "slug" "text",
    "is_published" boolean,
    "theme_id" "text",
    "is_private" boolean
);

--
-- Name: builder_module_classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_module_classes" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_private" boolean DEFAULT false NOT NULL
);

--
-- Name: builder_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_modules" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "module_type" "text" NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "module_class" "text" DEFAULT ''::"text" NOT NULL,
    "modules" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "class_id" bigint,
    "is_private" boolean DEFAULT false NOT NULL
);

--
-- Name: builder_page_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_page_revisions" (
    "id" bigint NOT NULL,
    "project_id" "text" DEFAULT ''::"text" NOT NULL,
    "page_id" bigint NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "slug" "text" DEFAULT ''::"text" NOT NULL,
    "template_id" "text" DEFAULT ''::"text" NOT NULL,
    "theme_id" "text",
    "layout_sections" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "page_background" "jsonb",
    "theme" "jsonb",
    "section_count" integer DEFAULT 0 NOT NULL,
    "module_count" integer DEFAULT 0 NOT NULL,
    "layout_bytes" integer DEFAULT 0 NOT NULL,
    "reason" "text" DEFAULT 'save'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "propagation_run_id" "text",
    "saved_by" "text",
    "saved_by_name" "text",
    "change_summary" "text",
    "owner_user_id" "text" DEFAULT ''::"text" NOT NULL
);

--
-- Name: TABLE "builder_page_revisions"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."builder_page_revisions" IS 'Per-page layout history. Each row is the state a page held BEFORE a layout-changing save. Pruned to the newest 25 per page by lib/builderPageRevisionsStore.js.';

--
-- Name: COLUMN "builder_page_revisions"."propagation_run_id"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."builder_page_revisions"."propagation_run_id" IS 'Shared id across every revision minted by one canonical-section propagation, so the whole fan-out can be undone as a single run. NULL = an ordinary single-page save.';

--
-- Name: COLUMN "builder_page_revisions"."saved_by"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."builder_page_revisions"."saved_by" IS 'User id of whoever made the save that replaced this version. NULL = recorded before this column existed, or an unauthenticated/system write.';

--
-- Name: COLUMN "builder_page_revisions"."saved_by_name"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."builder_page_revisions"."saved_by_name" IS 'Display name (falling back to email) as it stood at save time, denormalised so the history list renders without a join.';

--
-- Name: COLUMN "builder_page_revisions"."change_summary"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."builder_page_revisions"."change_summary" IS 'One line describing what the save that replaced this version did to it, computed at write time. NULL = recorded before this column existed.';

--
-- Name: COLUMN "builder_page_revisions"."owner_user_id"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."builder_page_revisions"."owner_user_id" IS 'Present so lib/projectScope.js recognises this as a tenant-scoped table and stamps project_id on insert. Without it, scopedInsertRow silently writes rows with no tenant at all.';

--
-- Name: builder_page_revisions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."builder_page_revisions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: builder_page_revisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."builder_page_revisions_id_seq" OWNED BY "public"."builder_page_revisions"."id";

--
-- Name: builder_page_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_page_snapshots" (
    "id" bigint NOT NULL,
    "project_id" "text" DEFAULT ''::"text" NOT NULL,
    "label" "text" DEFAULT ''::"text" NOT NULL,
    "page_count" integer DEFAULT 0 NOT NULL,
    "pages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: builder_page_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."builder_page_snapshots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: builder_page_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."builder_page_snapshots_id_seq" OWNED BY "public"."builder_page_snapshots"."id";

--
-- Name: builder_page_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_page_templates" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "template_id" "text" NOT NULL,
    "primary_color" "text",
    "background_color" "text",
    "accent_color" "text",
    "form_id" "text",
    "lead_magnet_id" "text",
    "headline_id" "text",
    "pitch_id" "text",
    "cta_id" "text",
    "website_banner_image_id" "text",
    "background_image_id" "text",
    "feature_image_id" "text",
    "highlight_image_id" "text",
    "feature_headline_id" "text",
    "feature_subheading_id" "text",
    "feature_title" "text",
    "feature_copy" "text",
    "highlight_headline_id" "text",
    "highlight_pitch_id" "text",
    "highlight_title" "text",
    "highlight_copy" "text",
    "body_headline_id" "text",
    "body_subheading_id" "text",
    "body_pitch_id" "text",
    "logo_wide_id" "text",
    "logo_square_id" "text",
    "content_overrides" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "template_kind" "text" DEFAULT 'fixed'::"text" NOT NULL,
    "layout_sections" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "email_function" "text",
    "summary" "text" DEFAULT ''::"text" NOT NULL,
    "subject" "text" DEFAULT ''::"text" NOT NULL,
    "email_slug" "text"
);

--
-- Name: builder_poll_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_poll_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "poll_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: builder_poll_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_poll_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "text" NOT NULL,
    "poll_id" "uuid" NOT NULL,
    "option_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: builder_polls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_polls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question" "text" NOT NULL,
    "category" "text",
    "order_index" integer DEFAULT 0,
    "is_published" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: builder_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_products" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "product_type" "text" DEFAULT 'merch'::"text" NOT NULL,
    "product_url" "text" DEFAULT ''::"text" NOT NULL,
    "image_url" "text" DEFAULT ''::"text" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: builder_published_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_published_pages" (
    "id" bigint NOT NULL,
    "project_id" "text" DEFAULT ''::"text" NOT NULL,
    "owner_user_id" "text" DEFAULT ''::"text" NOT NULL,
    "page_id" bigint NOT NULL,
    "slug" "text" DEFAULT ''::"text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "source_updated_at" timestamp with time zone,
    "build_id" "text" DEFAULT ''::"text" NOT NULL,
    "published_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: TABLE "builder_published_pages"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."builder_published_pages" IS 'The live snapshot of each page, written by Publish. Distinct from builder_landing_page.is_published, which is a visibility flag. A page with no row here has never been published and is served from its draft.';

--
-- Name: builder_published_pages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."builder_published_pages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: builder_published_pages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."builder_published_pages_id_seq" OWNED BY "public"."builder_published_pages"."id";

--
-- Name: builder_saved_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_saved_sections" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "section" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_private" boolean DEFAULT false NOT NULL
);

--
-- Name: builder_themes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."builder_themes" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "primary_color" "text" DEFAULT '#0b82d4'::"text" NOT NULL,
    "background_color" "text" DEFAULT '#f5fbff'::"text" NOT NULL,
    "accent_color" "text" DEFAULT '#1a4f81'::"text" NOT NULL,
    "border_thickness" integer DEFAULT 1 NOT NULL,
    "border_radius" integer DEFAULT 12 NOT NULL,
    "container_blur" integer DEFAULT 0 NOT NULL,
    "contrast_level" integer DEFAULT 0 NOT NULL,
    "logo_wide_id" "text" DEFAULT ''::"text" NOT NULL,
    "logo_square_id" "text" DEFAULT ''::"text" NOT NULL,
    "icon_primary_id" "text" DEFAULT ''::"text" NOT NULL,
    "icon_secondary_id" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "feature_image_id" "text" DEFAULT ''::"text" NOT NULL,
    "background_image_id" "text" DEFAULT ''::"text" NOT NULL,
    "typography" "jsonb",
    "secondary_color" "text",
    "top_margin" integer DEFAULT 0 NOT NULL,
    "bottom_margin" integer DEFAULT 0 NOT NULL,
    "side_margins" integer DEFAULT 0 NOT NULL,
    "page_background" "jsonb",
    "styles_page_background" "jsonb"
);

--
-- Name: campaign_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."campaign_events" (
    "id" "text" NOT NULL,
    "campaign_id" "text" NOT NULL,
    "contact_id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."campaigns" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "content" "text" NOT NULL,
    "segment_id" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "sent_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_sent_at" timestamp with time zone,
    "project_id" "text",
    "owner_user_id" "text"
);

--
-- Name: channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."channels" (
    "id" bigint NOT NULL,
    "channel" "text" NOT NULL,
    "user_name" "text" NOT NULL,
    "password" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "password_enc" "text",
    "password_iv" "text",
    "password_tag" "text",
    "key_version" "text",
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "channel_type" "text" DEFAULT 'organic'::"text" NOT NULL,
    "contact_id" "text",
    "openclaw_profile" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "channels_channel_type_check" CHECK (("channel_type" = ANY (ARRAY['organic'::"text", 'virtual'::"text"])))
);

--
-- Name: channels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."channels" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."channels_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: connection_ops_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."connection_ops_state" (
    "project_id" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "gates" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "attempts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: contact_field_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."contact_field_configs" (
    "id" "text" NOT NULL,
    "contact_type" "text" DEFAULT 'lead'::"text" NOT NULL,
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "field_type" "text" DEFAULT 'text'::"text" NOT NULL,
    "required" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "options" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: contact_personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."contact_personas" (
    "id" bigint NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "persona" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "type" character varying(50) DEFAULT 'persona'::character varying NOT NULL
);

--
-- Name: contact_personas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."contact_personas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: contact_personas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."contact_personas_id_seq" OWNED BY "public"."contact_personas"."id";

--
-- Name: contact_project_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."contact_project_invitations" (
    "id" "text" NOT NULL,
    "contact_id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "email" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "invited_by_user_id" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    "accepted_by_email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: contact_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."contact_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: contact_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."contact_statuses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: contact_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."contact_types" (
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"()
);

--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."contacts" (
    "id" "text" NOT NULL,
    "contact_type" "text" DEFAULT 'lead'::"text" NOT NULL,
    "email" "text",
    "first_name" "text",
    "last_name" "text",
    "company" "text",
    "phone" "text",
    "city" "text",
    "country" "text",
    "tags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "website" "text",
    "youtube" "text",
    "instagram" "text",
    "tiktok" "text",
    "facebook" "text",
    "x" "text",
    "bluesky" "text",
    "patreon" "text",
    "linkedin" "text",
    "source" "text",
    "status" "text",
    "notes" "text",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "contact_class" "text" DEFAULT 'persona'::"text",
    "entity_type" "text" DEFAULT 'Human'::"text" NOT NULL,
    "middle_name" "text",
    "person_id" "text",
    "auth_user_id" "text",
    CONSTRAINT "contacts_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['Human'::"text", 'Agent'::"text"])))
);

--
-- Name: content_item_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."content_item_assets" (
    "id" bigint NOT NULL,
    "content_item_id" bigint NOT NULL,
    "role" "text" DEFAULT 'primary'::"text" NOT NULL,
    "asset_id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: content_item_assets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."content_item_assets" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."content_item_assets_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: content_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."content_items" (
    "id" bigint NOT NULL,
    "type_id" bigint NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "summary" "text" DEFAULT ''::"text" NOT NULL,
    "category" "text" DEFAULT ''::"text" NOT NULL,
    "tags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "fields_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "publish_at" timestamp with time zone,
    "external_url" "text" DEFAULT ''::"text" NOT NULL,
    "legacy_table" "text" DEFAULT ''::"text" NOT NULL,
    "legacy_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "format" "text" DEFAULT ''::"text" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "url" "text" DEFAULT ''::"text" NOT NULL,
    "source_type" "text" DEFAULT ''::"text" NOT NULL,
    "source_id" "text" DEFAULT ''::"text" NOT NULL,
    "source_slug" "text" DEFAULT ''::"text" NOT NULL,
    "content_hash" "text" DEFAULT ''::"text" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    CONSTRAINT "content_items_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'archived'::"text"])))
);

--
-- Name: content_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."content_items" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."content_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: content_transform_handlers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."content_transform_handlers" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "type" "text" NOT NULL,
    "tag" "text" DEFAULT ''::"text" NOT NULL,
    "pattern" "text" DEFAULT ''::"text" NOT NULL,
    "replacement" "text" DEFAULT ''::"text" NOT NULL,
    "flags" "text" DEFAULT 'gi'::"text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "content_transform_handlers_type_check" CHECK (("type" = ANY (ARRAY['promote-h2'::"text", 'promote-h3'::"text", 'delete'::"text", 'strip-tag'::"text", 'find-replace'::"text", 'bold'::"text"])))
);

--
-- Name: TABLE "content_transform_handlers"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."content_transform_handlers" IS 'User-defined HTML transformation rules applied globally during content extraction. Not project-scoped.';

--
-- Name: content_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."content_types" (
    "id" bigint NOT NULL,
    "key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "plural_name" "text" NOT NULL,
    "family" "text" NOT NULL,
    "editor_mode" "text" DEFAULT 'simple'::"text" NOT NULL,
    "schema_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "ui_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "settings_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "source_table" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "content_types_editor_mode_check" CHECK (("editor_mode" = ANY (ARRAY['simple'::"text", 'structured'::"text"]))),
    CONSTRAINT "content_types_family_check" CHECK (("family" = ANY (ARRAY['short_form'::"text", 'long_form'::"text", 'social'::"text", 'support_copy'::"text"]))),
    CONSTRAINT "content_types_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text"])))
);

--
-- Name: content_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."content_types" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."content_types_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: crm_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_configs" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "owner_user_id" "text",
    "name" "text" DEFAULT 'CRM'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "standard_fields" "jsonb" DEFAULT '["email", "first_name", "last_name", "phone"]'::"jsonb" NOT NULL,
    "custom_fields" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: crm_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_contacts" (
    "id" "text" NOT NULL,
    "crm_config_id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "owner_user_id" "text",
    "email" "text",
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "source" "text" DEFAULT ''::"text",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: crm_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."crm_forms" (
    "id" "text" NOT NULL,
    "crm_config_id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "owner_user_id" "text",
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "heading" "text" DEFAULT ''::"text",
    "submit_label" "text" DEFAULT 'Submit'::"text",
    "success_message" "text" DEFAULT 'Thank you! Your information has been saved.'::"text",
    "error_message" "text" DEFAULT 'Something went wrong. Please try again.'::"text",
    "accent_color" "text" DEFAULT ''::"text",
    "fields" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "styles" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

--
-- Name: dev_friction_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."dev_friction_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "project_id" bigint,
    "description" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text",
    "resolution_notes" "text",
    "title" "text" DEFAULT 'New Friction Log'::"text" NOT NULL,
    "section" "text" DEFAULT 'Acquire'::"text",
    CONSTRAINT "roger_friction_logs_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'resolved'::"text", 'documented'::"text"])))
);

--
-- Name: dev_message_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."dev_message_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_message_id" bigint,
    "target_type" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "dev_message_links_target_type_check" CHECK (("target_type" = ANY (ARRAY['task'::"text", 'message'::"text"])))
);

--
-- Name: dev_project_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."dev_project_members" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "dev_project_id" "uuid" NOT NULL,
    "contact_id" character varying NOT NULL,
    "role" "text" DEFAULT 'member'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

--
-- Name: dev_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."dev_projects" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "app_project_id" character varying DEFAULT (("current_setting"('request.jwt.claims'::"text", true))::json ->> 'project_id'::"text") NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "dev_projects_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'archived'::"text"])))
);

--
-- Name: dev_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."dev_roles" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "project_id" character varying DEFAULT (("current_setting"('request.jwt.claims'::"text", true))::json ->> 'project_id'::"text") NOT NULL,
    "role_name" character varying NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

--
-- Name: dev_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."dev_sessions" (
    "id" bigint NOT NULL,
    "project_id" "text",
    "name" "text" DEFAULT 'New Discussion'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

--
-- Name: TABLE "dev_sessions"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."dev_sessions" IS 'Tri-Agent Discussion groups holding multiple chats';

--
-- Name: dev_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."dev_tasks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "project_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'todo'::"text",
    "priority" "text" DEFAULT 'medium'::"text",
    "assignee" "text" DEFAULT 'mentor'::"text",
    "related_friction_log_id" "uuid",
    "session_id" bigint,
    "estimated_completion_time" timestamp with time zone,
    "timer_active" boolean DEFAULT false,
    CONSTRAINT "dev_tasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "dev_tasks_status_check" CHECK (("status" = ANY (ARRAY['backlog'::"text", 'todo'::"text", 'in_progress'::"text", 'review'::"text", 'completed'::"text"])))
);

--
-- Name: dev_team; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."dev_team" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "project_id" character varying DEFAULT (("current_setting"('request.jwt.claims'::"text", true))::json ->> 'project_id'::"text") NOT NULL,
    "contact_id" character varying NOT NULL,
    "role" character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

--
-- Name: develop_email_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."develop_email_templates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: develop_email_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."develop_email_templates_id_seq" OWNED BY "public"."builder_email_templates"."id";

--
-- Name: develop_extensions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."develop_extensions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: develop_extensions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."develop_extensions_id_seq" OWNED BY "public"."builder_extensions"."id";

--
-- Name: develop_extensions_manager_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."develop_extensions_manager_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: develop_extensions_manager_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."develop_extensions_manager_id_seq" OWNED BY "public"."builder_extensions_manager"."id";

--
-- Name: develop_landing_page_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."develop_landing_page_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: develop_landing_page_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."develop_landing_page_id_seq" OWNED BY "public"."builder_landing_page"."id";

--
-- Name: develop_module_classes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_module_classes" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."develop_module_classes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: develop_page_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_page_templates" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."develop_page_templates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: direct_acquire_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."direct_acquire_runs" (
    "run_id" "text" NOT NULL,
    "source_url" "text" DEFAULT ''::"text" NOT NULL,
    "pages_succeeded" integer DEFAULT 0 NOT NULL,
    "pages_failed" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "run_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "detected_model_id" "text"
);

--
-- Name: COLUMN "direct_acquire_runs"."detected_model_id"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN "public"."direct_acquire_runs"."detected_model_id" IS 'Content display model auto-detected at crawl time (e.g. duda-alternating-2col). Null if no model matched.';

--
-- Name: engage_social_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."engage_social_posts" (
    "id" "text" NOT NULL,
    "channel" "text" DEFAULT 'x'::"text" NOT NULL,
    "campaign_id" "text" DEFAULT ''::"text" NOT NULL,
    "image_url" "text" DEFAULT ''::"text" NOT NULL,
    "image_alt" "text" DEFAULT ''::"text" NOT NULL,
    "post_text" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "scheduled_for" timestamp with time zone,
    "published_at" timestamp with time zone,
    "remote_id" "text" DEFAULT ''::"text" NOT NULL,
    "error" "text" DEFAULT ''::"text" NOT NULL,
    "diagnostics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: engage_youtube_comment_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."engage_youtube_comment_agents" (
    "id" "text" NOT NULL,
    "channel" "text" DEFAULT 'youtube_comments'::"text" NOT NULL,
    "video_url" "text" DEFAULT ''::"text" NOT NULL,
    "from_date" "text" DEFAULT ''::"text" NOT NULL,
    "to_date" "text" DEFAULT ''::"text" NOT NULL,
    "frequency" integer DEFAULT 1 NOT NULL,
    "timeframe" "text" DEFAULT 'month'::"text" NOT NULL,
    "max_posts" integer DEFAULT 1 NOT NULL,
    "video_comment_ratio" "text" DEFAULT '100/0'::"text" NOT NULL,
    "jitter_hours" integer DEFAULT 10 NOT NULL,
    "schedule_enabled" boolean DEFAULT false NOT NULL,
    "schedule_status" "text" DEFAULT 'disabled'::"text" NOT NULL,
    "schedule_note" "text" DEFAULT ''::"text" NOT NULL,
    "next_run_at" timestamp with time zone,
    "last_run_attempted_at" timestamp with time zone,
    "last_posted_at" timestamp with time zone,
    "last_posted_comment_id" "text" DEFAULT ''::"text" NOT NULL,
    "last_posted_thread_id" "text" DEFAULT ''::"text" NOT NULL,
    "total_posts_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text" DEFAULT ''::"text" NOT NULL,
    "last_test_posted_at" timestamp with time zone,
    "last_test_comment_id" "text" DEFAULT ''::"text" NOT NULL,
    "last_test_thread_id" "text" DEFAULT ''::"text" NOT NULL,
    "last_test_comment_text" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: game_level_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."game_level_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_name" "text" NOT NULL,
    "level_name" "text" NOT NULL,
    "sublevel_name" "text" DEFAULT ''::"text" NOT NULL,
    "module_id" "text",
    "trigger" "text" DEFAULT 'game'::"text" NOT NULL,
    "audience" "text" DEFAULT 'both'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_level_events_audience_check" CHECK (("audience" = ANY (ARRAY['public'::"text", 'portal'::"text", 'both'::"text"]))),
    CONSTRAINT "game_level_events_level_name_check" CHECK (("level_name" = ANY (ARRAY['Level'::"text", 'Grade'::"text", 'Class'::"text", 'Stage'::"text", 'Phase'::"text", 'Degree'::"text", 'Plane'::"text", 'Echelon'::"text", 'Tier'::"text"]))),
    CONSTRAINT "game_level_events_trigger_check" CHECK (("trigger" = 'game'::"text"))
);

--
-- Name: game_level_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."game_level_tiers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "level" integer NOT NULL,
    "tier" "text" NOT NULL,
    "name" "text" NOT NULL,
    "points_required" integer DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "perks" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_level_tiers_level_check" CHECK (("level" > 0)),
    CONSTRAINT "game_level_tiers_points_required_check" CHECK (("points_required" >= 0))
);

--
-- Name: game_level_up_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."game_level_up_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "level_name" "text" NOT NULL,
    "sublevel_name" "text" NOT NULL,
    "criteria" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_level_up_rules_level_name_check" CHECK (("level_name" = ANY (ARRAY['Level'::"text", 'Grade'::"text", 'Class'::"text", 'Stage'::"text", 'Phase'::"text", 'Degree'::"text", 'Plane'::"text", 'Echelon'::"text", 'Tier'::"text"])))
);

--
-- Name: game_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."game_levels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "level_name" "text" NOT NULL,
    "level_order" integer NOT NULL,
    "game_level_levels" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_levels_level_name_check" CHECK (("level_name" = ANY (ARRAY['Level'::"text", 'Grade'::"text", 'Class'::"text", 'Stage'::"text", 'Phase'::"text", 'Degree'::"text", 'Plane'::"text", 'Echelon'::"text", 'Tier'::"text"]))),
    CONSTRAINT "game_levels_level_order_check" CHECK ((("level_order" >= 1) AND ("level_order" <= 10)))
);

--
-- Name: game_progressive_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."game_progressive_features" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "feature_key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "unlock_level_name" "text" NOT NULL,
    "unlock_sublevel_name" "text" DEFAULT ''::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_progressive_features_unlock_level_name_check" CHECK (("unlock_level_name" = ANY (ARRAY['Level'::"text", 'Grade'::"text", 'Class'::"text", 'Stage'::"text", 'Phase'::"text", 'Degree'::"text", 'Plane'::"text", 'Echelon'::"text", 'Tier'::"text"])))
);

--
-- Name: game_rewards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."game_rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "reward_type" "text" DEFAULT 'custom'::"text" NOT NULL,
    "reward_order" integer DEFAULT 1 NOT NULL,
    "points_cost" integer DEFAULT 0 NOT NULL,
    "inventory_count" integer,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "image_url" "text" DEFAULT ''::"text" NOT NULL,
    "redemption_url" "text" DEFAULT ''::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_rewards_inventory_count_check" CHECK ((("inventory_count" IS NULL) OR ("inventory_count" >= 0))),
    CONSTRAINT "game_rewards_points_cost_check" CHECK (("points_cost" >= 0)),
    CONSTRAINT "game_rewards_reward_order_check" CHECK (("reward_order" >= 1)),
    CONSTRAINT "game_rewards_reward_type_check" CHECK (("reward_type" = ANY (ARRAY['badge'::"text", 'digital'::"text", 'access'::"text", 'feature'::"text", 'merch'::"text", 'token'::"text", 'custom'::"text"]))),
    CONSTRAINT "game_rewards_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'draft'::"text", 'archived'::"text"])))
);

--
-- Name: game_scoring; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."game_scoring" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "score_name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "specific_criteria" "text" DEFAULT ''::"text" NOT NULL,
    "points" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_scoring_points_check" CHECK (("points" >= 0))
);

--
-- Name: harvest_youtube_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."acquire_youtube_topics" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."harvest_youtube_categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: influencer_persona_harvests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."influencer_persona_harvests" (
    "id" bigint NOT NULL,
    "persona_id" bigint,
    "source_url" "text" NOT NULL,
    "source_id" "text",
    "transformed_asset_id" bigint,
    "post_status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "influencer_persona_harvests_post_status_check" CHECK (("post_status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'scheduled'::"text", 'posted'::"text", 'failed'::"text"])))
);

--
-- Name: influencer_persona_harvests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."influencer_persona_harvests" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."influencer_persona_harvests_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: influencer_personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."influencer_personas" (
    "id" bigint NOT NULL,
    "owner_id" "text",
    "base_name" "text" NOT NULL,
    "clone_name" "text",
    "clone_handle" "text",
    "primary_sources" "jsonb" DEFAULT '[]'::"jsonb",
    "agent_email" "text",
    "status" "text" DEFAULT 'Provisioning'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "influencer_personas_status_check" CHECK (("status" = ANY (ARRAY['Provisioning'::"text", 'Active'::"text", 'Paused'::"text", 'Restricted'::"text"])))
);

--
-- Name: influencer_personas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."influencer_personas" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."influencer_personas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."leads" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "email" "text" NOT NULL,
    "name" "text",
    "source" "text" DEFAULT 'unknown'::"text",
    "status" "text" DEFAULT 'new'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_contacted_at" timestamp with time zone
);

--
-- Name: memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."memories" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "lead_id" "uuid",
    "type" "text" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);

--
-- Name: messaging_articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_articles" (
    "id" bigint NOT NULL,
    "platform" "text" DEFAULT ''::"text" NOT NULL,
    "author" "text" DEFAULT ''::"text" NOT NULL,
    "title" "text" NOT NULL,
    "subtitle" "text" DEFAULT ''::"text" NOT NULL,
    "url" "text" DEFAULT ''::"text" NOT NULL,
    "content" "text" NOT NULL,
    "publish_date" timestamp with time zone,
    "thumbnail_asset_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "topic" "text",
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_articles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_articles_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_articles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_articles_id_seq" OWNED BY "public"."messaging_articles"."id";

--
-- Name: messaging_topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_topics" (
    "id" bigint NOT NULL,
    "topic" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text"
);

--
-- Name: messaging_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_categories_id_seq" OWNED BY "public"."messaging_topics"."id";

--
-- Name: messaging_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_comments" (
    "id" bigint NOT NULL,
    "comment" "text" DEFAULT ''::"text" NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_comments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_comments_id_seq" OWNED BY "public"."messaging_comments"."id";

--
-- Name: messaging_content_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_content_items" (
    "id" bigint NOT NULL,
    "type_key" "text" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "category" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: messaging_content_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_content_items" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."messaging_content_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: messaging_content_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_content_types" (
    "id" bigint NOT NULL,
    "key" "text" NOT NULL,
    "family" "text" DEFAULT ''::"text" NOT NULL,
    "singular_label" "text" NOT NULL,
    "plural_label" "text" NOT NULL,
    "field" "text" NOT NULL,
    "endpoint" "text" DEFAULT ''::"text" NOT NULL,
    "response_key" "text" DEFAULT ''::"text" NOT NULL,
    "item_stem" "text" DEFAULT ''::"text" NOT NULL,
    "page_stem" "text" DEFAULT ''::"text" NOT NULL,
    "page_id" "text" DEFAULT ''::"text" NOT NULL,
    "bulk_page_id" "text" DEFAULT ''::"text" NOT NULL,
    "input_placeholder" "text" DEFAULT ''::"text" NOT NULL,
    "rows" integer DEFAULT 4 NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "config_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: messaging_content_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_content_types" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."messaging_content_types_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: messaging_ctas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_ctas" (
    "id" bigint NOT NULL,
    "cta" "text" DEFAULT ''::"text" NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_ctas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_ctas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_ctas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_ctas_id_seq" OWNED BY "public"."messaging_ctas"."id";

--
-- Name: messaging_descriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_descriptions" (
    "id" bigint NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_descriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_descriptions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_descriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_descriptions_id_seq" OWNED BY "public"."messaging_descriptions"."id";

--
-- Name: messaging_ebooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_ebooks" (
    "id" bigint NOT NULL,
    "platform" "text" DEFAULT ''::"text" NOT NULL,
    "author" "text" DEFAULT ''::"text" NOT NULL,
    "title" "text" NOT NULL,
    "subtitle" "text" DEFAULT ''::"text" NOT NULL,
    "url" "text" DEFAULT ''::"text" NOT NULL,
    "content" "text" NOT NULL,
    "publish_date" timestamp with time zone,
    "thumbnail_asset_id" bigint,
    "pdf_name" "text" DEFAULT ''::"text" NOT NULL,
    "pdf_mime_type" "text" DEFAULT ''::"text" NOT NULL,
    "pdf_data_url" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "topic" "text",
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_ebooks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_ebooks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_ebooks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_ebooks_id_seq" OWNED BY "public"."messaging_ebooks"."id";

--
-- Name: messaging_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_emails" (
    "id" bigint NOT NULL,
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_emails_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_emails_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_emails_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_emails_id_seq" OWNED BY "public"."messaging_emails"."id";

--
-- Name: messaging_formats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_formats" (
    "id" bigint NOT NULL,
    "format" "text" NOT NULL,
    "family" "text" NOT NULL,
    "destination" "text",
    "page_id" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text"
);

--
-- Name: messaging_formats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_formats" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."messaging_formats_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: messaging_hashtags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_hashtags" (
    "id" bigint NOT NULL,
    "hashtag" "text" NOT NULL,
    "campaign_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "category" "text" DEFAULT ''::"text" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_hashtags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_hashtags" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."messaging_hashtags_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: messaging_headlines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_headlines" (
    "id" bigint NOT NULL,
    "headline" "text" NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_headlines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_headlines_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_headlines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_headlines_id_seq" OWNED BY "public"."messaging_headlines"."id";

--
-- Name: messaging_keywords; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_keywords" (
    "id" bigint NOT NULL,
    "keyword" "text" NOT NULL,
    "topic" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_keywords_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_keywords" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."messaging_keywords_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: messaging_pitches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_pitches" (
    "id" bigint NOT NULL,
    "pitch" "text" DEFAULT ''::"text" NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_pitches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_pitches_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_pitches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_pitches_id_seq" OWNED BY "public"."messaging_pitches"."id";

--
-- Name: messaging_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_posts" (
    "id" bigint NOT NULL,
    "post" "text" DEFAULT ''::"text" NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer,
    "url" "text" DEFAULT ''::"text" NOT NULL,
    "hashtags" "text" DEFAULT ''::"text" NOT NULL,
    "image_asset_id" bigint,
    "tagged_contact_id" "text"
);

--
-- Name: messaging_posts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_posts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_posts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_posts_id_seq" OWNED BY "public"."messaging_posts"."id";

--
-- Name: messaging_prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_prompts" (
    "id" bigint NOT NULL,
    "format" "text" NOT NULL,
    "topic" "text",
    "prompt_kind" "text",
    "prompt_text" "text" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: messaging_prompts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_prompts" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."messaging_prompts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: messaging_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_reports" (
    "id" bigint NOT NULL,
    "platform" "text" DEFAULT ''::"text" NOT NULL,
    "author" "text" DEFAULT ''::"text" NOT NULL,
    "title" "text" NOT NULL,
    "subtitle" "text" DEFAULT ''::"text" NOT NULL,
    "url" "text" DEFAULT ''::"text" NOT NULL,
    "content" "text" NOT NULL,
    "publish_date" timestamp with time zone,
    "thumbnail_asset_id" bigint,
    "pdf_name" "text" DEFAULT ''::"text" NOT NULL,
    "pdf_mime_type" "text" DEFAULT ''::"text" NOT NULL,
    "pdf_data_url" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "topic" "text",
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_reports_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_reports_id_seq" OWNED BY "public"."messaging_reports"."id";

--
-- Name: messaging_subheadings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_subheadings" (
    "id" bigint NOT NULL,
    "subheading" "text" NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_subheadings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_subheadings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_subheadings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_subheadings_id_seq" OWNED BY "public"."messaging_subheadings"."id";

--
-- Name: messaging_subject_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_subject_lines" (
    "id" bigint NOT NULL,
    "subject_line" "text" DEFAULT ''::"text" NOT NULL,
    "category" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: messaging_subject_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_subject_lines_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_subject_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_subject_lines_id_seq" OWNED BY "public"."messaging_subject_lines"."id";

--
-- Name: messaging_taglines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_taglines" (
    "id" bigint NOT NULL,
    "tagline" "text" NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_taglines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_taglines_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_taglines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_taglines_id_seq" OWNED BY "public"."messaging_taglines"."id";

--
-- Name: messaging_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_tags" (
    "id" bigint NOT NULL,
    "tag" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "topic" "text",
    "importance" smallint
);

--
-- Name: messaging_tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_tags" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."messaging_tags_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: messaging_transcripts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_transcripts" (
    "id" bigint NOT NULL,
    "transcript" "text" DEFAULT ''::"text" NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_transcripts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_transcripts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_transcripts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_transcripts_id_seq" OWNED BY "public"."messaging_transcripts"."id";

--
-- Name: messaging_tweets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_tweets" (
    "id" bigint NOT NULL,
    "content" "text" NOT NULL,
    "url" "text" DEFAULT ''::"text" NOT NULL,
    "hashtags" "text" DEFAULT ''::"text" NOT NULL,
    "image_asset_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_tweets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_tweets_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_tweets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_tweets_id_seq" OWNED BY "public"."messaging_tweets"."id";

--
-- Name: messaging_white_papers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_white_papers" (
    "id" bigint NOT NULL,
    "platform" "text" DEFAULT ''::"text" NOT NULL,
    "author" "text" DEFAULT ''::"text" NOT NULL,
    "title" "text" NOT NULL,
    "subtitle" "text" DEFAULT ''::"text" NOT NULL,
    "url" "text" DEFAULT ''::"text" NOT NULL,
    "content" "text" NOT NULL,
    "publish_date" timestamp with time zone,
    "thumbnail_asset_id" bigint,
    "pdf_name" "text" DEFAULT ''::"text" NOT NULL,
    "pdf_mime_type" "text" DEFAULT ''::"text" NOT NULL,
    "pdf_data_url" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "topic" "text",
    "project_id" "text",
    "owner_user_id" "text",
    "feedback" "text",
    "prompt_id" bigint,
    "quality_score" integer
);

--
-- Name: messaging_white_papers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_white_papers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_white_papers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_white_papers_id_seq" OWNED BY "public"."messaging_white_papers"."id";

--
-- Name: messaging_wyr_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."messaging_wyr_questions" (
    "id" bigint NOT NULL,
    "question" "text" NOT NULL,
    "topic" "text" DEFAULT ''::"text" NOT NULL,
    "object_kind" "text" DEFAULT 'messaging_wyr_question'::"text" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: messaging_wyr_questions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."messaging_wyr_questions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messaging_wyr_questions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."messaging_wyr_questions_id_seq" OWNED BY "public"."messaging_wyr_questions"."id";

--
-- Name: object_associations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."object_associations" (
    "id" bigint NOT NULL,
    "a_type" "text" NOT NULL,
    "a_id" "text" NOT NULL,
    "a_label" "text" DEFAULT ''::"text" NOT NULL,
    "b_type" "text" NOT NULL,
    "b_id" "text" NOT NULL,
    "b_label" "text" DEFAULT ''::"text" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: object_associations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."object_associations" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."object_associations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: observe_page_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."observe_page_views" (
    "id" bigint NOT NULL,
    "project_id" "text",
    "user_id" "text",
    "page_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);

--
-- Name: observe_page_views_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."observe_page_views" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."observe_page_views_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: observe_usage_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."observe_usage_logs" (
    "id" bigint NOT NULL,
    "project_id" "text",
    "user_id" "text",
    "provider" "text" NOT NULL,
    "usage_type" "text" NOT NULL,
    "usage_count" double precision DEFAULT 1 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);

--
-- Name: observe_usage_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."observe_usage_logs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."observe_usage_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: orchestrator_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."orchestrator_runs" (
    "project_id" "text" NOT NULL,
    "id" "text" NOT NULL,
    "owner_user_id" "text",
    "status" "text" DEFAULT 'completed'::"text" NOT NULL,
    "run_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: people; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."people" (
    "id" "text" NOT NULL,
    "email" "text",
    "first_name" "text" DEFAULT ''::"text" NOT NULL,
    "middle_name" "text" DEFAULT ''::"text" NOT NULL,
    "last_name" "text" DEFAULT ''::"text" NOT NULL,
    "company" "text" DEFAULT ''::"text" NOT NULL,
    "phone" "text" DEFAULT ''::"text" NOT NULL,
    "city" "text" DEFAULT ''::"text" NOT NULL,
    "country" "text" DEFAULT ''::"text" NOT NULL,
    "entity_type" "text" DEFAULT 'Human'::"text" NOT NULL,
    "auth_user_id" "text",
    "website" "text" DEFAULT ''::"text" NOT NULL,
    "youtube" "text" DEFAULT ''::"text" NOT NULL,
    "instagram" "text" DEFAULT ''::"text" NOT NULL,
    "tiktok" "text" DEFAULT ''::"text" NOT NULL,
    "facebook" "text" DEFAULT ''::"text" NOT NULL,
    "x" "text" DEFAULT ''::"text" NOT NULL,
    "bluesky" "text" DEFAULT ''::"text" NOT NULL,
    "patreon" "text" DEFAULT ''::"text" NOT NULL,
    "linkedin" "text" DEFAULT ''::"text" NOT NULL,
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: project_oauth_handoffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."project_oauth_handoffs" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "user_id" "text" NOT NULL,
    "provider" "text" DEFAULT 'facebook_page'::"text" NOT NULL,
    "pages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: project_social_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."project_social_credentials" (
    "project_id" "text" NOT NULL,
    "provider" "text" DEFAULT 'facebook_page'::"text" NOT NULL,
    "page_id" "text" DEFAULT ''::"text" NOT NULL,
    "page_name" "text" DEFAULT ''::"text" NOT NULL,
    "access_token_enc" "text" DEFAULT ''::"text" NOT NULL,
    "access_token_iv" "text" DEFAULT ''::"text" NOT NULL,
    "access_token_tag" "text" DEFAULT ''::"text" NOT NULL,
    "key_version" "text" DEFAULT 'v1'::"text" NOT NULL,
    "connected_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: promo_lead_field_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."promo_lead_field_configs" (
    "id" bigint NOT NULL,
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "type" "text" DEFAULT 'text'::"text" NOT NULL,
    "required" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "options" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: promo_lead_field_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."promo_lead_field_configs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."promo_lead_field_configs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: promo_memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."promo_memories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "lead_id" "uuid",
    "type" "text" NOT NULL,
    "content" "text" NOT NULL
);

--
-- Name: reddit_harvest_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."reddit_harvest_runs" (
    "run_id" "text" NOT NULL,
    "mode" "text" DEFAULT ''::"text" NOT NULL,
    "target" "text" DEFAULT ''::"text" NOT NULL,
    "subreddit" "text" DEFAULT ''::"text" NOT NULL,
    "post_id" "text" DEFAULT ''::"text" NOT NULL,
    "request_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "result_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "stats" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: roger_chats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."agent_messages" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."roger_chats_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: roger_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."dev_sessions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."roger_sessions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: segment_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."segment_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."segments" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "rules" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "definition" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "text",
    "owner_user_id" "text"
);

--
-- Name: theme_wizard_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."theme_wizard_candidates" (
    "id" "text" NOT NULL,
    "session_id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "round" integer DEFAULT 1 NOT NULL,
    "slot" integer DEFAULT 1 NOT NULL,
    "direction" "text" DEFAULT ''::"text" NOT NULL,
    "rationale" "text" DEFAULT ''::"text" NOT NULL,
    "theme_patch" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "parent_candidate_id" "text",
    "rank" integer,
    "feedback" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "theme_wizard_candidates_rank_check" CHECK ((("rank" IS NULL) OR (("rank" >= 1) AND ("rank" <= 3)))),
    CONSTRAINT "theme_wizard_candidates_slot_check" CHECK ((("slot" >= 1) AND ("slot" <= 3)))
);

--
-- Name: theme_wizard_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."theme_wizard_jobs" (
    "id" "text" NOT NULL,
    "session_id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "owner_user_id" "text",
    "type" "text" DEFAULT 'generate_round'::"text" NOT NULL,
    "input" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "error" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    CONSTRAINT "theme_wizard_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'succeeded'::"text", 'failed'::"text"])))
);

--
-- Name: theme_wizard_library_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."theme_wizard_library_entries" (
    "id" "text" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "theme_patch" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "source_session_id" "text",
    "origin_project_id" "text",
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: theme_wizard_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."theme_wizard_sessions" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "owner_user_id" "text",
    "seed_type" "text" DEFAULT 'current_pages'::"text" NOT NULL,
    "seed_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "style_brief" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "preview_page_id" "text",
    "locked_values" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "round_count" integer DEFAULT 0 NOT NULL,
    "tokens_spent" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "applied_candidate_id" "text",
    "apply_snapshot_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "theme_wizard_sessions_seed_type_check" CHECK (("seed_type" = ANY (ARRAY['current_pages'::"text", 'external_url'::"text", 'brand_kit'::"text", 'brief'::"text"]))),
    CONSTRAINT "theme_wizard_sessions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'applied'::"text", 'abandoned'::"text"])))
);

--
-- Name: training_corpus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."training_corpus" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "title" "text" NOT NULL,
    "source_type" "text" NOT NULL,
    "category" "text" DEFAULT 'General'::"text",
    "content_text" "text" NOT NULL,
    "embedding" "public"."vector"(1536),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb"
);

--
-- Name: training_rules_guides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."training_rules_guides" (
    "user_id" "text" NOT NULL,
    "item_id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "text" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "training_rules_guides_type_check" CHECK (("type" = ANY (ARRAY['rule'::"text", 'guide'::"text"])))
);

--
-- Name: training_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."training_settings" (
    "user_id" "text" NOT NULL,
    "explicit_isitas_percent" integer DEFAULT 50 NOT NULL,
    "subtle_shared_framing_percent" integer DEFAULT 40 NOT NULL,
    "generic_context_percent" integer DEFAULT 10 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "training_settings_explicit_isitas_percent_check" CHECK ((("explicit_isitas_percent" >= 0) AND ("explicit_isitas_percent" <= 100))),
    CONSTRAINT "training_settings_generic_context_percent_check" CHECK ((("generic_context_percent" >= 0) AND ("generic_context_percent" <= 100))),
    CONSTRAINT "training_settings_subtle_shared_framing_percent_check" CHECK ((("subtle_shared_framing_percent" >= 0) AND ("subtle_shared_framing_percent" <= 100)))
);

--
-- Name: training_taxonomy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."training_taxonomy" (
    "user_id" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "item_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "rationale" "text" DEFAULT ''::"text" NOT NULL,
    "value_rank" integer DEFAULT 3 NOT NULL,
    "match_hashtags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "training_taxonomy_kind_check" CHECK (("kind" = ANY (ARRAY['category'::"text", 'attribute'::"text", 'approach'::"text"]))),
    CONSTRAINT "training_taxonomy_value_rank_check" CHECK ((("value_rank" >= 1) AND ("value_rank" <= 5)))
);

--
-- Name: website_peers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."website_peers" (
    "id" bigint NOT NULL,
    "site_type" "text" DEFAULT 'peer'::"text" NOT NULL,
    "source_url" "text" DEFAULT ''::"text" NOT NULL,
    "source_domain" "text" DEFAULT ''::"text" NOT NULL,
    "site_url" "text" DEFAULT ''::"text" NOT NULL,
    "domain" "text" DEFAULT ''::"text" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "website_model" "text" DEFAULT ''::"text" NOT NULL,
    "matched_keywords" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "snippet" "text" DEFAULT ''::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "last_harvested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_acquired_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "website_peers_site_type_check" CHECK (("site_type" = ANY (ARRAY['source'::"text", 'peer'::"text"])))
);

--
-- Name: website_peers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE "public"."website_peers" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."website_peers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

--
-- Name: x_harvest_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."x_harvest_runs" (
    "run_id" "text" NOT NULL,
    "query" "text" DEFAULT ''::"text" NOT NULL,
    "language" "text" DEFAULT ''::"text" NOT NULL,
    "start_time" "text" DEFAULT ''::"text" NOT NULL,
    "end_time" "text" DEFAULT ''::"text" NOT NULL,
    "max_tweets" integer DEFAULT 0 NOT NULL,
    "max_replies_per_tweet" integer DEFAULT 0 NOT NULL,
    "include_replies" boolean DEFAULT false NOT NULL,
    "request_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "result_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "stats" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "project_id" "text",
    "owner_user_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: youtube_comment_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."youtube_comment_runs" (
    "id" "text" NOT NULL,
    "video_id" "text" NOT NULL,
    "video_url" "text" NOT NULL,
    "sort_by" "text" DEFAULT 'relevance'::"text" NOT NULL,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "top_level_count" integer DEFAULT 0 NOT NULL,
    "reply_count" integer DEFAULT 0 NOT NULL,
    "total_comments" integer DEFAULT 0 NOT NULL,
    "unique_authors" integer DEFAULT 0 NOT NULL,
    "total_likes" integer DEFAULT 0 NOT NULL,
    "signals_emails" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "signals_handles" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "top_comments" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "comments" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: activity_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."activity_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."activity_log_id_seq"'::"regclass");

--
-- Name: builder_email_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_email_templates" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."develop_email_templates_id_seq"'::"regclass");

--
-- Name: builder_extensions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_extensions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."develop_extensions_id_seq"'::"regclass");

--
-- Name: builder_extensions_manager id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_extensions_manager" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."develop_extensions_manager_id_seq"'::"regclass");

--
-- Name: builder_landing_page id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_landing_page" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."develop_landing_page_id_seq"'::"regclass");

--
-- Name: builder_page_revisions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_page_revisions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."builder_page_revisions_id_seq"'::"regclass");

--
-- Name: builder_page_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_page_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."builder_page_snapshots_id_seq"'::"regclass");

--
-- Name: builder_published_pages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_published_pages" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."builder_published_pages_id_seq"'::"regclass");

--
-- Name: contact_personas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contact_personas" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."contact_personas_id_seq"'::"regclass");

--
-- Name: messaging_articles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_articles" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_articles_id_seq"'::"regclass");

--
-- Name: messaging_comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_comments" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_comments_id_seq"'::"regclass");

--
-- Name: messaging_ctas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_ctas" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_ctas_id_seq"'::"regclass");

--
-- Name: messaging_descriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_descriptions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_descriptions_id_seq"'::"regclass");

--
-- Name: messaging_ebooks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_ebooks" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_ebooks_id_seq"'::"regclass");

--
-- Name: messaging_emails id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_emails" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_emails_id_seq"'::"regclass");

--
-- Name: messaging_headlines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_headlines" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_headlines_id_seq"'::"regclass");

--
-- Name: messaging_pitches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_pitches" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_pitches_id_seq"'::"regclass");

--
-- Name: messaging_posts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_posts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_posts_id_seq"'::"regclass");

--
-- Name: messaging_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_reports" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_reports_id_seq"'::"regclass");

--
-- Name: messaging_subheadings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_subheadings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_subheadings_id_seq"'::"regclass");

--
-- Name: messaging_subject_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_subject_lines" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_subject_lines_id_seq"'::"regclass");

--
-- Name: messaging_taglines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_taglines" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_taglines_id_seq"'::"regclass");

--
-- Name: messaging_topics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_topics" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_categories_id_seq"'::"regclass");

--
-- Name: messaging_transcripts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_transcripts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_transcripts_id_seq"'::"regclass");

--
-- Name: messaging_tweets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_tweets" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_tweets_id_seq"'::"regclass");

--
-- Name: messaging_white_papers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_white_papers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_white_papers_id_seq"'::"regclass");

--
-- Name: messaging_wyr_questions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_wyr_questions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messaging_wyr_questions_id_seq"'::"regclass");

--
-- Name: acquire_job_mirror acquire_job_mirror_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."acquire_job_mirror"
    ADD CONSTRAINT "acquire_job_mirror_pkey" PRIMARY KEY ("project_id", "id");

--
-- Name: acquire_youtube_comment_records acquire_youtube_comment_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."acquire_youtube_comment_records"
    ADD CONSTRAINT "acquire_youtube_comment_records_pkey" PRIMARY KEY ("comment_id");

--
-- Name: acquire_youtube_comments acquire_youtube_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."acquire_youtube_comments"
    ADD CONSTRAINT "acquire_youtube_comments_pkey" PRIMARY KEY ("run_id");

--
-- Name: acquire_youtube_topics acquire_youtube_topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."acquire_youtube_topics"
    ADD CONSTRAINT "acquire_youtube_topics_pkey" PRIMARY KEY ("id");

--
-- Name: acquire_youtube_videos acquire_youtube_videos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."acquire_youtube_videos"
    ADD CONSTRAINT "acquire_youtube_videos_pkey" PRIMARY KEY ("video_record_id");

--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id");

--
-- Name: app_auth_sessions app_auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_auth_sessions"
    ADD CONSTRAINT "app_auth_sessions_pkey" PRIMARY KEY ("token");

--
-- Name: app_auth_users app_auth_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_auth_users"
    ADD CONSTRAINT "app_auth_users_email_key" UNIQUE ("email");

--
-- Name: app_auth_users app_auth_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_auth_users"
    ADD CONSTRAINT "app_auth_users_pkey" PRIMARY KEY ("id");

--
-- Name: app_credential_identities app_credential_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_credential_identities"
    ADD CONSTRAINT "app_credential_identities_pkey" PRIMARY KEY ("id");

--
-- Name: app_invitations app_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_invitations"
    ADD CONSTRAINT "app_invitations_pkey" PRIMARY KEY ("id");

--
-- Name: app_project_admin_password_resets app_project_admin_password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_project_admin_password_resets"
    ADD CONSTRAINT "app_project_admin_password_resets_pkey" PRIMARY KEY ("id");

--
-- Name: app_project_admin_sessions app_project_admin_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_project_admin_sessions"
    ADD CONSTRAINT "app_project_admin_sessions_pkey" PRIMARY KEY ("token");

--
-- Name: app_project_admin_users app_project_admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_project_admin_users"
    ADD CONSTRAINT "app_project_admin_users_pkey" PRIMARY KEY ("id");

--
-- Name: app_project_memberships app_project_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_project_memberships"
    ADD CONSTRAINT "app_project_memberships_pkey" PRIMARY KEY ("project_id", "user_id");

--
-- Name: app_project_support_requests app_project_support_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_project_support_requests"
    ADD CONSTRAINT "app_project_support_requests_pkey" PRIMARY KEY ("id");

--
-- Name: app_projects app_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_projects"
    ADD CONSTRAINT "app_projects_pkey" PRIMARY KEY ("id");

--
-- Name: app_projects app_projects_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_projects"
    ADD CONSTRAINT "app_projects_slug_key" UNIQUE ("slug");

--
-- Name: app_site_import_assets app_site_import_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_site_import_assets"
    ADD CONSTRAINT "app_site_import_assets_pkey" PRIMARY KEY ("id");

--
-- Name: app_site_import_jobs app_site_import_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_site_import_jobs"
    ADD CONSTRAINT "app_site_import_jobs_pkey" PRIMARY KEY ("id");

--
-- Name: asset_associations asset_associations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."asset_associations"
    ADD CONSTRAINT "asset_associations_pkey" PRIMARY KEY ("id");

--
-- Name: asset_categories asset_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."asset_categories"
    ADD CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id");

--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_pkey" PRIMARY KEY ("id");

--
-- Name: assets_video_curation assets_video_curation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."assets_video_curation"
    ADD CONSTRAINT "assets_video_curation_pkey" PRIMARY KEY ("id");

--
-- Name: blog_card_template blog_card_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."blog_card_template"
    ADD CONSTRAINT "blog_card_template_pkey" PRIMARY KEY ("project_id");

--
-- Name: blog_categories blog_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."blog_categories"
    ADD CONSTRAINT "blog_categories_pkey" PRIMARY KEY ("id");

--
-- Name: blog_post_categories blog_post_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."blog_post_categories"
    ADD CONSTRAINT "blog_post_categories_pkey" PRIMARY KEY ("post_id", "category_id");

--
-- Name: blog_posts blog_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."blog_posts"
    ADD CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id");

--
-- Name: builder_clusters builder_clusters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_clusters"
    ADD CONSTRAINT "builder_clusters_pkey" PRIMARY KEY ("id");

--
-- Name: builder_page_revisions builder_page_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_page_revisions"
    ADD CONSTRAINT "builder_page_revisions_pkey" PRIMARY KEY ("id");

--
-- Name: builder_page_snapshots builder_page_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_page_snapshots"
    ADD CONSTRAINT "builder_page_snapshots_pkey" PRIMARY KEY ("id");

--
-- Name: builder_poll_options builder_poll_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_poll_options"
    ADD CONSTRAINT "builder_poll_options_pkey" PRIMARY KEY ("id");

--
-- Name: builder_poll_responses builder_poll_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_poll_responses"
    ADD CONSTRAINT "builder_poll_responses_pkey" PRIMARY KEY ("id");

--
-- Name: builder_polls builder_polls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_polls"
    ADD CONSTRAINT "builder_polls_pkey" PRIMARY KEY ("id");

--
-- Name: builder_published_pages builder_published_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_published_pages"
    ADD CONSTRAINT "builder_published_pages_pkey" PRIMARY KEY ("id");

--
-- Name: campaign_events campaign_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."campaign_events"
    ADD CONSTRAINT "campaign_events_pkey" PRIMARY KEY ("id");

--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id");

--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."channels"
    ADD CONSTRAINT "channels_pkey" PRIMARY KEY ("id");

--
-- Name: connection_ops_state connection_ops_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."connection_ops_state"
    ADD CONSTRAINT "connection_ops_state_pkey" PRIMARY KEY ("project_id", "platform");

--
-- Name: contact_field_configs contact_field_configs_contact_type_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contact_field_configs"
    ADD CONSTRAINT "contact_field_configs_contact_type_key_key" UNIQUE ("contact_type", "key");

--
-- Name: contact_field_configs contact_field_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contact_field_configs"
    ADD CONSTRAINT "contact_field_configs_pkey" PRIMARY KEY ("id");

--
-- Name: contact_personas contact_personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contact_personas"
    ADD CONSTRAINT "contact_personas_pkey" PRIMARY KEY ("id");

--
-- Name: contact_project_invitations contact_project_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contact_project_invitations"
    ADD CONSTRAINT "contact_project_invitations_pkey" PRIMARY KEY ("id");

--
-- Name: contact_project_invitations contact_project_invitations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contact_project_invitations"
    ADD CONSTRAINT "contact_project_invitations_token_hash_key" UNIQUE ("token_hash");

--
-- Name: contact_sources contact_sources_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contact_sources"
    ADD CONSTRAINT "contact_sources_key_key" UNIQUE ("key");

--
-- Name: contact_sources contact_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contact_sources"
    ADD CONSTRAINT "contact_sources_pkey" PRIMARY KEY ("id");

--
-- Name: contact_statuses contact_statuses_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contact_statuses"
    ADD CONSTRAINT "contact_statuses_key_key" UNIQUE ("key");

--
-- Name: contact_statuses contact_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contact_statuses"
    ADD CONSTRAINT "contact_statuses_pkey" PRIMARY KEY ("id");

--
-- Name: contact_types contact_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contact_types"
    ADD CONSTRAINT "contact_types_pkey" PRIMARY KEY ("key");

--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");

--
-- Name: content_item_assets content_item_assets_content_item_id_role_asset_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."content_item_assets"
    ADD CONSTRAINT "content_item_assets_content_item_id_role_asset_id_key" UNIQUE ("content_item_id", "role", "asset_id");

--
-- Name: content_item_assets content_item_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."content_item_assets"
    ADD CONSTRAINT "content_item_assets_pkey" PRIMARY KEY ("id");

--
-- Name: content_items content_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_pkey" PRIMARY KEY ("id");

--
-- Name: content_transform_handlers content_transform_handlers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."content_transform_handlers"
    ADD CONSTRAINT "content_transform_handlers_pkey" PRIMARY KEY ("id");

--
-- Name: content_types content_types_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."content_types"
    ADD CONSTRAINT "content_types_key_key" UNIQUE ("key");

--
-- Name: content_types content_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."content_types"
    ADD CONSTRAINT "content_types_pkey" PRIMARY KEY ("id");

--
-- Name: crm_configs crm_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_configs"
    ADD CONSTRAINT "crm_configs_pkey" PRIMARY KEY ("id");

--
-- Name: crm_contacts crm_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_contacts"
    ADD CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id");

--
-- Name: crm_forms crm_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."crm_forms"
    ADD CONSTRAINT "crm_forms_pkey" PRIMARY KEY ("id");

--
-- Name: dev_message_links dev_message_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_message_links"
    ADD CONSTRAINT "dev_message_links_pkey" PRIMARY KEY ("id");

--
-- Name: dev_project_members dev_project_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_project_members"
    ADD CONSTRAINT "dev_project_members_pkey" PRIMARY KEY ("id");

--
-- Name: dev_project_members dev_project_members_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_project_members"
    ADD CONSTRAINT "dev_project_members_unique" UNIQUE ("dev_project_id", "contact_id");

--
-- Name: dev_projects dev_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_projects"
    ADD CONSTRAINT "dev_projects_pkey" PRIMARY KEY ("id");

--
-- Name: dev_roles dev_roles_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_roles"
    ADD CONSTRAINT "dev_roles_name_unique" UNIQUE ("project_id", "role_name");

--
-- Name: dev_roles dev_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_roles"
    ADD CONSTRAINT "dev_roles_pkey" PRIMARY KEY ("id");

--
-- Name: dev_tasks dev_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_tasks"
    ADD CONSTRAINT "dev_tasks_pkey" PRIMARY KEY ("id");

--
-- Name: dev_team dev_team_contact_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_team"
    ADD CONSTRAINT "dev_team_contact_unique" UNIQUE ("project_id", "contact_id");

--
-- Name: dev_team dev_team_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_team"
    ADD CONSTRAINT "dev_team_pkey" PRIMARY KEY ("id");

--
-- Name: builder_email_templates develop_email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_email_templates"
    ADD CONSTRAINT "develop_email_templates_pkey" PRIMARY KEY ("id");

--
-- Name: builder_email_templates develop_email_templates_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_email_templates"
    ADD CONSTRAINT "develop_email_templates_slug_key" UNIQUE ("slug");

--
-- Name: builder_extensions_manager develop_extensions_manager_manager_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_extensions_manager"
    ADD CONSTRAINT "develop_extensions_manager_manager_key_key" UNIQUE ("manager_key");

--
-- Name: builder_extensions_manager develop_extensions_manager_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_extensions_manager"
    ADD CONSTRAINT "develop_extensions_manager_pkey" PRIMARY KEY ("id");

--
-- Name: builder_extensions develop_extensions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_extensions"
    ADD CONSTRAINT "develop_extensions_pkey" PRIMARY KEY ("id");

--
-- Name: builder_extensions develop_extensions_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_extensions"
    ADD CONSTRAINT "develop_extensions_slug_key" UNIQUE ("slug");

--
-- Name: builder_forms develop_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_forms"
    ADD CONSTRAINT "develop_forms_pkey" PRIMARY KEY ("id");

--
-- Name: builder_icons develop_icons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_icons"
    ADD CONSTRAINT "develop_icons_pkey" PRIMARY KEY ("id");

--
-- Name: builder_landing_page develop_landing_page_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_landing_page"
    ADD CONSTRAINT "develop_landing_page_pkey" PRIMARY KEY ("id");

--
-- Name: builder_module_classes develop_module_classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_module_classes"
    ADD CONSTRAINT "develop_module_classes_pkey" PRIMARY KEY ("id");

--
-- Name: builder_modules develop_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_modules"
    ADD CONSTRAINT "develop_modules_pkey" PRIMARY KEY ("id");

--
-- Name: builder_page_templates develop_page_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_page_templates"
    ADD CONSTRAINT "develop_page_templates_pkey" PRIMARY KEY ("id");

--
-- Name: builder_products develop_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_products"
    ADD CONSTRAINT "develop_products_pkey" PRIMARY KEY ("id");

--
-- Name: builder_saved_sections develop_saved_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_saved_sections"
    ADD CONSTRAINT "develop_saved_sections_pkey" PRIMARY KEY ("id");

--
-- Name: builder_themes develop_themes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_themes"
    ADD CONSTRAINT "develop_themes_pkey" PRIMARY KEY ("id");

--
-- Name: direct_acquire_runs direct_acquire_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."direct_acquire_runs"
    ADD CONSTRAINT "direct_acquire_runs_pkey" PRIMARY KEY ("run_id");

--
-- Name: engage_social_posts engage_social_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."engage_social_posts"
    ADD CONSTRAINT "engage_social_posts_pkey" PRIMARY KEY ("id");

--
-- Name: engage_youtube_comment_agents engage_youtube_comment_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."engage_youtube_comment_agents"
    ADD CONSTRAINT "engage_youtube_comment_agents_pkey" PRIMARY KEY ("id");

--
-- Name: game_level_events game_level_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."game_level_events"
    ADD CONSTRAINT "game_level_events_pkey" PRIMARY KEY ("id");

--
-- Name: game_level_tiers game_level_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."game_level_tiers"
    ADD CONSTRAINT "game_level_tiers_pkey" PRIMARY KEY ("id");

--
-- Name: game_level_tiers game_level_tiers_project_id_level_tier_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."game_level_tiers"
    ADD CONSTRAINT "game_level_tiers_project_id_level_tier_key" UNIQUE ("project_id", "level", "tier");

--
-- Name: game_level_up_rules game_level_up_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."game_level_up_rules"
    ADD CONSTRAINT "game_level_up_rules_pkey" PRIMARY KEY ("id");

--
-- Name: game_levels game_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."game_levels"
    ADD CONSTRAINT "game_levels_pkey" PRIMARY KEY ("id");

--
-- Name: game_progressive_features game_progressive_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."game_progressive_features"
    ADD CONSTRAINT "game_progressive_features_pkey" PRIMARY KEY ("id");

--
-- Name: game_progressive_features game_progressive_features_project_id_feature_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."game_progressive_features"
    ADD CONSTRAINT "game_progressive_features_project_id_feature_key_key" UNIQUE ("project_id", "feature_key");

--
-- Name: game_rewards game_rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."game_rewards"
    ADD CONSTRAINT "game_rewards_pkey" PRIMARY KEY ("id");

--
-- Name: game_scoring game_scoring_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."game_scoring"
    ADD CONSTRAINT "game_scoring_pkey" PRIMARY KEY ("id");

--
-- Name: acquire_youtube_topics harvest_youtube_categories_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."acquire_youtube_topics"
    ADD CONSTRAINT "harvest_youtube_categories_category_key" UNIQUE ("topic");

--
-- Name: influencer_persona_harvests influencer_persona_harvests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."influencer_persona_harvests"
    ADD CONSTRAINT "influencer_persona_harvests_pkey" PRIMARY KEY ("id");

--
-- Name: influencer_personas influencer_personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."influencer_personas"
    ADD CONSTRAINT "influencer_personas_pkey" PRIMARY KEY ("id");

--
-- Name: leads leads_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_email_key" UNIQUE ("email");

--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");

--
-- Name: memories memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."memories"
    ADD CONSTRAINT "memories_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_articles messaging_articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_articles"
    ADD CONSTRAINT "messaging_articles_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_topics messaging_categories_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_topics"
    ADD CONSTRAINT "messaging_categories_category_key" UNIQUE ("topic");

--
-- Name: messaging_topics messaging_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_topics"
    ADD CONSTRAINT "messaging_categories_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_comments messaging_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_comments"
    ADD CONSTRAINT "messaging_comments_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_content_items messaging_content_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_content_items"
    ADD CONSTRAINT "messaging_content_items_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_content_types messaging_content_types_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_content_types"
    ADD CONSTRAINT "messaging_content_types_key_key" UNIQUE ("key");

--
-- Name: messaging_content_types messaging_content_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_content_types"
    ADD CONSTRAINT "messaging_content_types_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_ctas messaging_ctas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_ctas"
    ADD CONSTRAINT "messaging_ctas_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_descriptions messaging_descriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_descriptions"
    ADD CONSTRAINT "messaging_descriptions_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_ebooks messaging_ebooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_ebooks"
    ADD CONSTRAINT "messaging_ebooks_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_emails messaging_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_emails"
    ADD CONSTRAINT "messaging_emails_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_formats messaging_formats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_formats"
    ADD CONSTRAINT "messaging_formats_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_hashtags messaging_hashtags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_hashtags"
    ADD CONSTRAINT "messaging_hashtags_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_headlines messaging_headlines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_headlines"
    ADD CONSTRAINT "messaging_headlines_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_keywords messaging_keywords_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_keywords"
    ADD CONSTRAINT "messaging_keywords_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_pitches messaging_pitches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_pitches"
    ADD CONSTRAINT "messaging_pitches_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_posts messaging_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_posts"
    ADD CONSTRAINT "messaging_posts_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_prompts messaging_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_prompts"
    ADD CONSTRAINT "messaging_prompts_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_reports messaging_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_reports"
    ADD CONSTRAINT "messaging_reports_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_subheadings messaging_subheadings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_subheadings"
    ADD CONSTRAINT "messaging_subheadings_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_subject_lines messaging_subject_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_subject_lines"
    ADD CONSTRAINT "messaging_subject_lines_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_taglines messaging_taglines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_taglines"
    ADD CONSTRAINT "messaging_taglines_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_tags messaging_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_tags"
    ADD CONSTRAINT "messaging_tags_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_transcripts messaging_transcripts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_transcripts"
    ADD CONSTRAINT "messaging_transcripts_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_tweets messaging_tweets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_tweets"
    ADD CONSTRAINT "messaging_tweets_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_white_papers messaging_white_papers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_white_papers"
    ADD CONSTRAINT "messaging_white_papers_pkey" PRIMARY KEY ("id");

--
-- Name: messaging_wyr_questions messaging_wyr_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_wyr_questions"
    ADD CONSTRAINT "messaging_wyr_questions_pkey" PRIMARY KEY ("id");

--
-- Name: object_associations object_associations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."object_associations"
    ADD CONSTRAINT "object_associations_pkey" PRIMARY KEY ("id");

--
-- Name: observe_page_views observe_page_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."observe_page_views"
    ADD CONSTRAINT "observe_page_views_pkey" PRIMARY KEY ("id");

--
-- Name: observe_usage_logs observe_usage_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."observe_usage_logs"
    ADD CONSTRAINT "observe_usage_logs_pkey" PRIMARY KEY ("id");

--
-- Name: orchestrator_runs orchestrator_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."orchestrator_runs"
    ADD CONSTRAINT "orchestrator_runs_pkey" PRIMARY KEY ("project_id", "id");

--
-- Name: people people_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."people"
    ADD CONSTRAINT "people_pkey" PRIMARY KEY ("id");

--
-- Name: project_oauth_handoffs project_oauth_handoffs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."project_oauth_handoffs"
    ADD CONSTRAINT "project_oauth_handoffs_pkey" PRIMARY KEY ("id");

--
-- Name: project_social_credentials project_social_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."project_social_credentials"
    ADD CONSTRAINT "project_social_credentials_pkey" PRIMARY KEY ("project_id", "provider");

--
-- Name: promo_lead_field_configs promo_lead_field_configs_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."promo_lead_field_configs"
    ADD CONSTRAINT "promo_lead_field_configs_key_key" UNIQUE ("key");

--
-- Name: promo_lead_field_configs promo_lead_field_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."promo_lead_field_configs"
    ADD CONSTRAINT "promo_lead_field_configs_pkey" PRIMARY KEY ("id");

--
-- Name: promo_memories promo_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."promo_memories"
    ADD CONSTRAINT "promo_memories_pkey" PRIMARY KEY ("id");

--
-- Name: reddit_harvest_runs reddit_harvest_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."reddit_harvest_runs"
    ADD CONSTRAINT "reddit_harvest_runs_pkey" PRIMARY KEY ("run_id");

--
-- Name: agent_messages roger_chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."agent_messages"
    ADD CONSTRAINT "roger_chats_pkey" PRIMARY KEY ("id");

--
-- Name: dev_friction_logs roger_friction_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_friction_logs"
    ADD CONSTRAINT "roger_friction_logs_pkey" PRIMARY KEY ("id");

--
-- Name: dev_sessions roger_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_sessions"
    ADD CONSTRAINT "roger_sessions_pkey" PRIMARY KEY ("id");

--
-- Name: segment_types segment_types_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."segment_types"
    ADD CONSTRAINT "segment_types_key_key" UNIQUE ("key");

--
-- Name: segment_types segment_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."segment_types"
    ADD CONSTRAINT "segment_types_pkey" PRIMARY KEY ("id");

--
-- Name: segments segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."segments"
    ADD CONSTRAINT "segments_pkey" PRIMARY KEY ("id");

--
-- Name: theme_wizard_candidates theme_wizard_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."theme_wizard_candidates"
    ADD CONSTRAINT "theme_wizard_candidates_pkey" PRIMARY KEY ("id");

--
-- Name: theme_wizard_candidates theme_wizard_candidates_session_id_round_slot_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."theme_wizard_candidates"
    ADD CONSTRAINT "theme_wizard_candidates_session_id_round_slot_key" UNIQUE ("session_id", "round", "slot");

--
-- Name: theme_wizard_jobs theme_wizard_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."theme_wizard_jobs"
    ADD CONSTRAINT "theme_wizard_jobs_pkey" PRIMARY KEY ("id");

--
-- Name: theme_wizard_library_entries theme_wizard_library_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."theme_wizard_library_entries"
    ADD CONSTRAINT "theme_wizard_library_entries_pkey" PRIMARY KEY ("id");

--
-- Name: theme_wizard_sessions theme_wizard_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."theme_wizard_sessions"
    ADD CONSTRAINT "theme_wizard_sessions_pkey" PRIMARY KEY ("id");

--
-- Name: training_corpus training_corpus_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."training_corpus"
    ADD CONSTRAINT "training_corpus_pkey" PRIMARY KEY ("id");

--
-- Name: training_rules_guides training_rules_guides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."training_rules_guides"
    ADD CONSTRAINT "training_rules_guides_pkey" PRIMARY KEY ("user_id", "item_id");

--
-- Name: training_settings training_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."training_settings"
    ADD CONSTRAINT "training_settings_pkey" PRIMARY KEY ("user_id");

--
-- Name: training_taxonomy training_taxonomy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."training_taxonomy"
    ADD CONSTRAINT "training_taxonomy_pkey" PRIMARY KEY ("user_id", "kind", "item_id");

--
-- Name: website_peers website_peers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."website_peers"
    ADD CONSTRAINT "website_peers_pkey" PRIMARY KEY ("id");

--
-- Name: x_harvest_runs x_harvest_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."x_harvest_runs"
    ADD CONSTRAINT "x_harvest_runs_pkey" PRIMARY KEY ("run_id");

--
-- Name: youtube_comment_runs youtube_comment_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."youtube_comment_runs"
    ADD CONSTRAINT "youtube_comment_runs_pkey" PRIMARY KEY ("id");

--
-- Name: acquire_youtube_details youtube_harvest_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."acquire_youtube_details"
    ADD CONSTRAINT "youtube_harvest_runs_pkey" PRIMARY KEY ("run_id");

--
-- Name: acquire_youtube_comments_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "acquire_youtube_comments_created_at_idx" ON "public"."acquire_youtube_comments" USING "btree" ("created_at" DESC);

--
-- Name: acquire_youtube_details_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "acquire_youtube_details_created_at_idx" ON "public"."acquire_youtube_details" USING "btree" ("created_at" DESC);

--
-- Name: acquire_youtube_details_topic_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "acquire_youtube_details_topic_idx" ON "public"."acquire_youtube_details" USING "btree" ("topic");

--
-- Name: acquire_youtube_details_transcript_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "acquire_youtube_details_transcript_status_idx" ON "public"."acquire_youtube_details" USING "btree" ("transcript_status");

--
-- Name: acquire_youtube_topics_topic_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "acquire_youtube_topics_topic_idx" ON "public"."acquire_youtube_topics" USING "btree" ("topic");

--
-- Name: acquire_youtube_videos_media_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "acquire_youtube_videos_media_job_idx" ON "public"."acquire_youtube_videos" USING "btree" ("media_job_id") WHERE ("media_job_id" <> ''::"text");

--
-- Name: app_projects_domain_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "app_projects_domain_unique" ON "public"."app_projects" USING "btree" ("domain") WHERE ("domain" <> ''::"text");

--
-- Name: assets_aspect_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assets_aspect_idx" ON "public"."assets" USING "btree" ("aspect");

--
-- Name: assets_renditions_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "assets_renditions_pending_idx" ON "public"."assets" USING "btree" ("id") WHERE ("renditions" = '[]'::"jsonb");

--
-- Name: builder_email_templates_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_email_templates_kind_idx" ON "public"."builder_email_templates" USING "btree" ("template_kind", "updated_at" DESC);

--
-- Name: builder_email_templates_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_email_templates_updated_at_idx" ON "public"."builder_email_templates" USING "btree" ("updated_at" DESC);

--
-- Name: builder_extensions_featured_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_extensions_featured_idx" ON "public"."builder_extensions" USING "btree" ("is_featured", "usage_count" DESC, "updated_at" DESC);

--
-- Name: builder_extensions_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_extensions_name_idx" ON "public"."builder_extensions" USING "btree" ("name");

--
-- Name: builder_extensions_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_extensions_parent_idx" ON "public"."builder_extensions" USING "btree" ("parent_id");

--
-- Name: builder_extensions_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_extensions_type_idx" ON "public"."builder_extensions" USING "btree" ("extension_type");

--
-- Name: builder_landing_page_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_landing_page_name_idx" ON "public"."builder_landing_page" USING "btree" ("name");

--
-- Name: builder_landing_page_page_template_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_landing_page_page_template_id_idx" ON "public"."builder_landing_page" USING "btree" ("page_template_id");

--
-- Name: builder_landing_page_template_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_landing_page_template_id_idx" ON "public"."builder_landing_page" USING "btree" ("template_id");

--
-- Name: builder_page_revisions_owner_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_page_revisions_owner_user_id_idx" ON "public"."builder_page_revisions" USING "btree" ("owner_user_id");

--
-- Name: builder_page_revisions_page_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_page_revisions_page_created_idx" ON "public"."builder_page_revisions" USING "btree" ("page_id", "created_at" DESC);

--
-- Name: builder_page_revisions_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_page_revisions_project_id_idx" ON "public"."builder_page_revisions" USING "btree" ("project_id");

--
-- Name: builder_page_revisions_propagation_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_page_revisions_propagation_run_idx" ON "public"."builder_page_revisions" USING "btree" ("propagation_run_id") WHERE ("propagation_run_id" IS NOT NULL);

--
-- Name: builder_page_snapshots_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_page_snapshots_created_at_idx" ON "public"."builder_page_snapshots" USING "btree" ("created_at" DESC);

--
-- Name: builder_page_snapshots_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_page_snapshots_project_id_idx" ON "public"."builder_page_snapshots" USING "btree" ("project_id");

--
-- Name: builder_page_templates_email_function_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_page_templates_email_function_idx" ON "public"."builder_page_templates" USING "btree" ("email_function") WHERE ("template_kind" = 'email'::"text");

--
-- Name: builder_published_pages_build_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_published_pages_build_idx" ON "public"."builder_published_pages" USING "btree" ("build_id");

--
-- Name: builder_published_pages_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "builder_published_pages_page_idx" ON "public"."builder_published_pages" USING "btree" ("page_id");

--
-- Name: builder_published_pages_project_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "builder_published_pages_project_slug_idx" ON "public"."builder_published_pages" USING "btree" ("project_id", "slug");

--
-- Name: contact_field_configs_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "contact_field_configs_type_idx" ON "public"."contact_field_configs" USING "btree" ("contact_type", "sort_order");

--
-- Name: contact_personas_persona_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "contact_personas_persona_idx" ON "public"."contact_personas" USING "btree" ("persona");

--
-- Name: contact_personas_project_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "contact_personas_project_owner_idx" ON "public"."contact_personas" USING "btree" ("project_id", "owner_user_id");

--
-- Name: contact_personas_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "contact_personas_type_idx" ON "public"."contact_personas" USING "btree" ("type");

--
-- Name: contacts_custom_fields_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "contacts_custom_fields_gin_idx" ON "public"."contacts" USING "gin" ("custom_fields");

--
-- Name: contacts_email_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "contacts_email_unique_idx" ON "public"."contacts" USING "btree" ("email") WHERE (("email" IS NOT NULL) AND ("email" <> ''::"text"));

--
-- Name: contacts_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "contacts_name_idx" ON "public"."contacts" USING "btree" ("lower"("first_name"), "lower"("last_name"));

--
-- Name: contacts_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "contacts_source_idx" ON "public"."contacts" USING "btree" ("source") WHERE ("source" IS NOT NULL);

--
-- Name: contacts_tags_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "contacts_tags_gin_idx" ON "public"."contacts" USING "gin" ("tags");

--
-- Name: contacts_type_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "contacts_type_created_idx" ON "public"."contacts" USING "btree" ("contact_type", "created_at" DESC);

--
-- Name: contacts_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "contacts_type_idx" ON "public"."contacts" USING "btree" ("contact_type");

--
-- Name: contacts_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "contacts_updated_at_idx" ON "public"."contacts" USING "btree" ("updated_at" DESC);

--
-- Name: develop_forms_contact_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "develop_forms_contact_type_idx" ON "public"."builder_forms" USING "btree" ("contact_type");

--
-- Name: develop_forms_form_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "develop_forms_form_type_idx" ON "public"."builder_forms" USING "btree" ("form_type");

--
-- Name: develop_forms_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "develop_forms_name_idx" ON "public"."builder_forms" USING "btree" ("name");

--
-- Name: develop_landing_page_slug_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "develop_landing_page_slug_project_idx" ON "public"."builder_landing_page" USING "btree" ("project_id", "slug") WHERE (("slug" IS NOT NULL) AND ("slug" <> ''::"text"));

--
-- Name: develop_page_templates_email_slug_project_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "develop_page_templates_email_slug_project_uidx" ON "public"."builder_page_templates" USING "btree" ("project_id", "email_slug") WHERE (("template_kind" = 'email'::"text") AND ("email_slug" IS NOT NULL) AND ("email_slug" <> ''::"text"));

--
-- Name: develop_themes_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "develop_themes_updated_idx" ON "public"."builder_themes" USING "btree" ("updated_at" DESC);

--
-- Name: engage_youtube_comment_agents_next_run_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "engage_youtube_comment_agents_next_run_at_idx" ON "public"."engage_youtube_comment_agents" USING "btree" ("next_run_at");

--
-- Name: engage_youtube_comment_agents_schedule_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "engage_youtube_comment_agents_schedule_enabled_idx" ON "public"."engage_youtube_comment_agents" USING "btree" ("schedule_enabled");

--
-- Name: engage_youtube_comment_agents_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "engage_youtube_comment_agents_updated_at_idx" ON "public"."engage_youtube_comment_agents" USING "btree" ("updated_at" DESC);

--
-- Name: engage_youtube_comment_agents_video_url_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "engage_youtube_comment_agents_video_url_idx" ON "public"."engage_youtube_comment_agents" USING "btree" ("video_url");

--
-- Name: harvest_youtube_comments_video_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "harvest_youtube_comments_video_id_idx" ON "public"."acquire_youtube_comments" USING "btree" ("video_id");

--
-- Name: idx_acquire_job_mirror_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_acquire_job_mirror_updated" ON "public"."acquire_job_mirror" USING "btree" ("project_id", "updated_at" DESC);

--
-- Name: idx_acquire_yt_comments_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_acquire_yt_comments_campaign" ON "public"."acquire_youtube_comment_records" USING "btree" ("campaign_id");

--
-- Name: idx_acquire_yt_comments_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_acquire_yt_comments_created" ON "public"."acquire_youtube_comment_records" USING "btree" ("created_at" DESC);

--
-- Name: idx_acquire_yt_comments_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_acquire_yt_comments_score" ON "public"."acquire_youtube_comment_records" USING "btree" ("score" DESC);

--
-- Name: idx_acquire_yt_comments_video; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_acquire_yt_comments_video" ON "public"."acquire_youtube_comment_records" USING "btree" ("video_id");

--
-- Name: idx_activity_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_activity_log_created_at" ON "public"."activity_log" USING "btree" ("created_at" DESC);

--
-- Name: idx_activity_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_activity_log_entity" ON "public"."activity_log" USING "btree" ("entity_type", "entity_id");

--
-- Name: idx_app_auth_sessions_active_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_app_auth_sessions_active_project_id" ON "public"."app_auth_sessions" USING "btree" ("active_project_id") WHERE ("active_project_id" IS NOT NULL);

--
-- Name: idx_app_auth_sessions_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_app_auth_sessions_expires_at" ON "public"."app_auth_sessions" USING "btree" ("expires_at");

--
-- Name: idx_app_auth_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_app_auth_sessions_user_id" ON "public"."app_auth_sessions" USING "btree" ("user_id");

--
-- Name: idx_app_auth_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_app_auth_users_email" ON "public"."app_auth_users" USING "btree" ("email");

--
-- Name: idx_app_invitations_invited_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_app_invitations_invited_by" ON "public"."app_invitations" USING "btree" ("invited_by_user_id");

--
-- Name: idx_app_invitations_pending_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_app_invitations_pending_email" ON "public"."app_invitations" USING "btree" ("lower"("email")) WHERE ("status" = 'pending'::"text");

--
-- Name: idx_app_invitations_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_app_invitations_project_id" ON "public"."app_invitations" USING "btree" ("project_id");

--
-- Name: idx_app_invitations_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_app_invitations_token_hash" ON "public"."app_invitations" USING "btree" ("token_hash");

--
-- Name: idx_app_project_memberships_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_app_project_memberships_user" ON "public"."app_project_memberships" USING "btree" ("user_id");

--
-- Name: idx_app_projects_domain_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_app_projects_domain_unique" ON "public"."app_projects" USING "btree" ("lower"("domain")) WHERE ("domain" <> ''::"text");

--
-- Name: idx_asset_associations_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_asset_associations_asset_id" ON "public"."asset_associations" USING "btree" ("asset_id");

--
-- Name: idx_asset_associations_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_asset_associations_project_id" ON "public"."asset_associations" USING "btree" ("project_id");

--
-- Name: idx_asset_associations_unique_target; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_asset_associations_unique_target" ON "public"."asset_associations" USING "btree" ("asset_id", "target_type", "target_id", COALESCE("project_id", ''::"text"));

--
-- Name: idx_asset_categories_parent_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_asset_categories_parent_category_id" ON "public"."asset_categories" USING "btree" ("parent_category_id");

--
-- Name: idx_asset_categories_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_asset_categories_project_id" ON "public"."asset_categories" USING "btree" ("project_id");

--
-- Name: idx_asset_categories_project_type_parent_category; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_asset_categories_project_type_parent_category" ON "public"."asset_categories" USING "btree" ("project_id", "asset_type", "lower"("category"), COALESCE("parent_category_id", (0)::bigint));

--
-- Name: idx_assets_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_assets_created_at" ON "public"."assets" USING "btree" ("created_at" DESC);

--
-- Name: idx_assets_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_assets_project_id" ON "public"."assets" USING "btree" ("project_id");

--
-- Name: idx_assets_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_assets_updated_at" ON "public"."assets" USING "btree" ("updated_at" DESC);

--
-- Name: idx_assets_video_curation_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_assets_video_curation_score" ON "public"."assets_video_curation" USING "btree" ("score" DESC);

--
-- Name: idx_assets_video_curation_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_assets_video_curation_topic" ON "public"."assets_video_curation" USING "btree" ("topic");

--
-- Name: idx_assets_video_curation_video_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_assets_video_curation_video_id" ON "public"."assets_video_curation" USING "btree" ("video_id");

--
-- Name: idx_blog_categories_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_blog_categories_project_id" ON "public"."blog_categories" USING "btree" ("project_id");

--
-- Name: idx_blog_categories_slug_project; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_blog_categories_slug_project" ON "public"."blog_categories" USING "btree" ("project_id", "slug") WHERE ("slug" <> ''::"text");

--
-- Name: idx_blog_post_categories_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_blog_post_categories_category_id" ON "public"."blog_post_categories" USING "btree" ("category_id");

--
-- Name: idx_blog_posts_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_blog_posts_project_id" ON "public"."blog_posts" USING "btree" ("project_id");

--
-- Name: idx_blog_posts_published_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_blog_posts_published_at" ON "public"."blog_posts" USING "btree" ("project_id", "published_at" DESC NULLS LAST);

--
-- Name: idx_blog_posts_slug_project; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_blog_posts_slug_project" ON "public"."blog_posts" USING "btree" ("project_id", "slug") WHERE ("slug" <> ''::"text");

--
-- Name: idx_blog_posts_status_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_blog_posts_status_project" ON "public"."blog_posts" USING "btree" ("project_id", "status");

--
-- Name: idx_builder_icons_project_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_icons_project_created" ON "public"."builder_icons" USING "btree" ("project_id", "created_at" DESC);

--
-- Name: idx_builder_module_classes_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_module_classes_project_id" ON "public"."builder_module_classes" USING "btree" ("project_id");

--
-- Name: idx_builder_modules_module_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_modules_module_class" ON "public"."builder_modules" USING "btree" ("module_class");

--
-- Name: idx_builder_modules_module_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_modules_module_type" ON "public"."builder_modules" USING "btree" ("module_type");

--
-- Name: idx_builder_modules_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_modules_project_id" ON "public"."builder_modules" USING "btree" ("project_id");

--
-- Name: idx_builder_page_templates_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_page_templates_project_id" ON "public"."builder_page_templates" USING "btree" ("project_id");

--
-- Name: idx_builder_page_templates_template_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_page_templates_template_id" ON "public"."builder_page_templates" USING "btree" ("template_id");

--
-- Name: idx_builder_poll_options_poll_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_poll_options_poll_id" ON "public"."builder_poll_options" USING "btree" ("poll_id");

--
-- Name: idx_builder_poll_responses_option_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_poll_responses_option_id" ON "public"."builder_poll_responses" USING "btree" ("option_id");

--
-- Name: idx_builder_poll_responses_poll_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_poll_responses_poll_id" ON "public"."builder_poll_responses" USING "btree" ("poll_id");

--
-- Name: idx_builder_poll_responses_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_poll_responses_session_id" ON "public"."builder_poll_responses" USING "btree" ("session_id");

--
-- Name: idx_builder_products_product_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_products_product_type" ON "public"."builder_products" USING "btree" ("product_type");

--
-- Name: idx_builder_products_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_products_project_id" ON "public"."builder_products" USING "btree" ("project_id");

--
-- Name: idx_builder_saved_sections_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_saved_sections_project_id" ON "public"."builder_saved_sections" USING "btree" ("project_id");

--
-- Name: idx_builder_saved_sections_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_saved_sections_updated_at" ON "public"."builder_saved_sections" USING "btree" ("updated_at" DESC);

--
-- Name: idx_builder_themes_owner_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_themes_owner_user_id" ON "public"."builder_themes" USING "btree" ("owner_user_id");

--
-- Name: idx_builder_themes_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_builder_themes_project_id" ON "public"."builder_themes" USING "btree" ("project_id");

--
-- Name: idx_campaign_events_campaign_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_campaign_events_campaign_id" ON "public"."campaign_events" USING "btree" ("campaign_id");

--
-- Name: idx_campaigns_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_campaigns_project_id" ON "public"."campaigns" USING "btree" ("project_id");

--
-- Name: idx_channels_contact_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_channels_contact_id" ON "public"."channels" USING "btree" ("contact_id");

--
-- Name: idx_channels_openclaw_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_channels_openclaw_profile" ON "public"."channels" USING "btree" ("openclaw_profile") WHERE ("openclaw_profile" <> ''::"text");

--
-- Name: idx_channels_owner_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_channels_owner_user_id" ON "public"."channels" USING "btree" ("owner_user_id");

--
-- Name: idx_channels_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_channels_project_id" ON "public"."channels" USING "btree" ("project_id");

--
-- Name: idx_connection_ops_state_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_connection_ops_state_updated" ON "public"."connection_ops_state" USING "btree" ("project_id", "updated_at" DESC);

--
-- Name: idx_contact_personas_owner_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_contact_personas_owner_user_id" ON "public"."contact_personas" USING "btree" ("owner_user_id");

--
-- Name: idx_contact_personas_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_contact_personas_project_id" ON "public"."contact_personas" USING "btree" ("project_id");

--
-- Name: idx_contacts_contact_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_contacts_contact_class" ON "public"."contacts" USING "btree" ("contact_class");

--
-- Name: idx_contacts_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_contacts_email" ON "public"."contacts" USING "btree" ("email");

--
-- Name: idx_contacts_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_contacts_person_id" ON "public"."contacts" USING "btree" ("person_id");

--
-- Name: idx_contacts_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_contacts_project_id" ON "public"."contacts" USING "btree" ("project_id");

--
-- Name: idx_contacts_project_person; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_contacts_project_person" ON "public"."contacts" USING "btree" ("project_id", "person_id") WHERE (("person_id" IS NOT NULL) AND ("project_id" IS NOT NULL));

--
-- Name: idx_content_item_assets_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_content_item_assets_asset" ON "public"."content_item_assets" USING "btree" ("asset_id");

--
-- Name: idx_content_item_assets_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_content_item_assets_item" ON "public"."content_item_assets" USING "btree" ("content_item_id");

--
-- Name: idx_content_items_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_content_items_category" ON "public"."content_items" USING "btree" ("category");

--
-- Name: idx_content_items_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_content_items_created_at" ON "public"."content_items" USING "btree" ("created_at" DESC);

--
-- Name: idx_content_items_fields_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_content_items_fields_gin" ON "public"."content_items" USING "gin" ("fields_json");

--
-- Name: idx_content_items_format; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_content_items_format" ON "public"."content_items" USING "btree" ("format");

--
-- Name: idx_content_items_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_content_items_project_id" ON "public"."content_items" USING "btree" ("project_id");

--
-- Name: idx_content_items_publish_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_content_items_publish_at" ON "public"."content_items" USING "btree" ("publish_at");

--
-- Name: idx_content_items_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_content_items_source" ON "public"."content_items" USING "btree" ("source_type", "source_id");

--
-- Name: idx_content_items_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_content_items_status" ON "public"."content_items" USING "btree" ("status");

--
-- Name: idx_content_items_tags_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_content_items_tags_gin" ON "public"."content_items" USING "gin" ("tags");

--
-- Name: idx_content_items_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_content_items_type_id" ON "public"."content_items" USING "btree" ("type_id");

--
-- Name: idx_content_transform_handlers_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_content_transform_handlers_enabled" ON "public"."content_transform_handlers" USING "btree" ("enabled");

--
-- Name: idx_cpi_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_cpi_contact" ON "public"."contact_project_invitations" USING "btree" ("contact_id");

--
-- Name: idx_cpi_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_cpi_project" ON "public"."contact_project_invitations" USING "btree" ("project_id");

--
-- Name: idx_cpi_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_cpi_status" ON "public"."contact_project_invitations" USING "btree" ("status");

--
-- Name: idx_cpi_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_cpi_token" ON "public"."contact_project_invitations" USING "btree" ("token_hash");

--
-- Name: idx_credential_identities_project_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_credential_identities_project_provider" ON "public"."app_credential_identities" USING "btree" ("project_id", "provider");

--
-- Name: idx_crm_configs_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_configs_project_id" ON "public"."crm_configs" USING "btree" ("project_id");

--
-- Name: idx_crm_contacts_crm_config_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_contacts_crm_config_id" ON "public"."crm_contacts" USING "btree" ("crm_config_id");

--
-- Name: idx_crm_contacts_email_per_config; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_crm_contacts_email_per_config" ON "public"."crm_contacts" USING "btree" ("crm_config_id", "lower"("email")) WHERE (("email" IS NOT NULL) AND ("email" <> ''::"text"));

--
-- Name: idx_crm_contacts_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_contacts_project_id" ON "public"."crm_contacts" USING "btree" ("project_id");

--
-- Name: idx_crm_forms_crm_config_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_forms_crm_config_id" ON "public"."crm_forms" USING "btree" ("crm_config_id");

--
-- Name: idx_crm_forms_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_crm_forms_project_id" ON "public"."crm_forms" USING "btree" ("project_id");

--
-- Name: idx_develop_email_templates_owner_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_develop_email_templates_owner_user_id" ON "public"."builder_email_templates" USING "btree" ("owner_user_id");

--
-- Name: idx_develop_email_templates_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_develop_email_templates_project_id" ON "public"."builder_email_templates" USING "btree" ("project_id");

--
-- Name: idx_develop_extensions_manager_owner_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_develop_extensions_manager_owner_user_id" ON "public"."builder_extensions_manager" USING "btree" ("owner_user_id");

--
-- Name: idx_develop_extensions_manager_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_develop_extensions_manager_project_id" ON "public"."builder_extensions_manager" USING "btree" ("project_id");

--
-- Name: idx_develop_extensions_owner_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_develop_extensions_owner_user_id" ON "public"."builder_extensions" USING "btree" ("owner_user_id");

--
-- Name: idx_develop_extensions_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_develop_extensions_project_id" ON "public"."builder_extensions" USING "btree" ("project_id");

--
-- Name: idx_develop_landing_page_owner_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_develop_landing_page_owner_user_id" ON "public"."builder_landing_page" USING "btree" ("owner_user_id");

--
-- Name: idx_develop_landing_page_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_develop_landing_page_project_id" ON "public"."builder_landing_page" USING "btree" ("project_id");

--
-- Name: idx_direct_acquire_runs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_direct_acquire_runs_created_at" ON "public"."direct_acquire_runs" USING "btree" ("created_at" DESC);

--
-- Name: idx_direct_acquire_runs_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_direct_acquire_runs_project_id" ON "public"."direct_acquire_runs" USING "btree" ("project_id");

--
-- Name: idx_engage_social_posts_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_engage_social_posts_project_id" ON "public"."engage_social_posts" USING "btree" ("project_id");

--
-- Name: idx_engage_social_posts_status_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_engage_social_posts_status_scheduled" ON "public"."engage_social_posts" USING "btree" ("status", "scheduled_for");

--
-- Name: idx_game_level_events_module_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_game_level_events_module_id" ON "public"."game_level_events" USING "btree" ("module_id");

--
-- Name: idx_game_level_events_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_game_level_events_project_id" ON "public"."game_level_events" USING "btree" ("project_id");

--
-- Name: idx_game_level_events_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_game_level_events_target" ON "public"."game_level_events" USING "btree" ("level_name", "sublevel_name");

--
-- Name: idx_game_level_tiers_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_game_level_tiers_project_id" ON "public"."game_level_tiers" USING "btree" ("project_id");

--
-- Name: idx_game_level_up_rules_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_game_level_up_rules_project_id" ON "public"."game_level_up_rules" USING "btree" ("project_id");

--
-- Name: idx_game_levels_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_game_levels_project_id" ON "public"."game_levels" USING "btree" ("project_id");

--
-- Name: idx_game_progressive_features_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_game_progressive_features_project_id" ON "public"."game_progressive_features" USING "btree" ("project_id");

--
-- Name: idx_game_rewards_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_game_rewards_project_id" ON "public"."game_rewards" USING "btree" ("project_id");

--
-- Name: idx_game_scoring_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_game_scoring_project_id" ON "public"."game_scoring" USING "btree" ("project_id");

--
-- Name: idx_leads_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_leads_email" ON "public"."leads" USING "btree" ("email");

--
-- Name: idx_memories_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_memories_lead_id" ON "public"."memories" USING "btree" ("lead_id");

--
-- Name: idx_messaging_articles_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_articles_project_id" ON "public"."messaging_articles" USING "btree" ("project_id");

--
-- Name: idx_messaging_articles_publish_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_articles_publish_date" ON "public"."messaging_articles" USING "btree" ("publish_date" DESC NULLS LAST);

--
-- Name: idx_messaging_articles_thumbnail_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_articles_thumbnail_asset_id" ON "public"."messaging_articles" USING "btree" ("thumbnail_asset_id");

--
-- Name: idx_messaging_comments_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_comments_category" ON "public"."messaging_comments" USING "btree" ("topic");

--
-- Name: idx_messaging_comments_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_comments_created_at" ON "public"."messaging_comments" USING "btree" ("created_at" DESC);

--
-- Name: idx_messaging_comments_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_comments_project_id" ON "public"."messaging_comments" USING "btree" ("project_id");

--
-- Name: idx_messaging_content_items_type_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_content_items_type_key" ON "public"."messaging_content_items" USING "btree" ("type_key");

--
-- Name: idx_messaging_ctas_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_ctas_category" ON "public"."messaging_ctas" USING "btree" ("topic");

--
-- Name: idx_messaging_ctas_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_ctas_created_at" ON "public"."messaging_ctas" USING "btree" ("created_at" DESC);

--
-- Name: idx_messaging_ctas_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_ctas_project_id" ON "public"."messaging_ctas" USING "btree" ("project_id");

--
-- Name: idx_messaging_descriptions_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_descriptions_category" ON "public"."messaging_descriptions" USING "btree" ("topic");

--
-- Name: idx_messaging_descriptions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_descriptions_created_at" ON "public"."messaging_descriptions" USING "btree" ("created_at" DESC);

--
-- Name: idx_messaging_descriptions_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_descriptions_project_id" ON "public"."messaging_descriptions" USING "btree" ("project_id");

--
-- Name: idx_messaging_ebooks_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_ebooks_project_id" ON "public"."messaging_ebooks" USING "btree" ("project_id");

--
-- Name: idx_messaging_ebooks_publish_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_ebooks_publish_date" ON "public"."messaging_ebooks" USING "btree" ("publish_date" DESC NULLS LAST);

--
-- Name: idx_messaging_ebooks_thumbnail_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_ebooks_thumbnail_asset_id" ON "public"."messaging_ebooks" USING "btree" ("thumbnail_asset_id");

--
-- Name: idx_messaging_emails_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_emails_category" ON "public"."messaging_emails" USING "btree" ("topic");

--
-- Name: idx_messaging_emails_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_emails_created_at" ON "public"."messaging_emails" USING "btree" ("created_at" DESC);

--
-- Name: idx_messaging_emails_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_emails_project_id" ON "public"."messaging_emails" USING "btree" ("project_id");

--
-- Name: idx_messaging_formats_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_formats_family" ON "public"."messaging_formats" USING "btree" ("family");

--
-- Name: idx_messaging_formats_project_format; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_messaging_formats_project_format" ON "public"."messaging_formats" USING "btree" ("project_id", "lower"("format"));

--
-- Name: idx_messaging_formats_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_formats_project_id" ON "public"."messaging_formats" USING "btree" ("project_id");

--
-- Name: idx_messaging_hashtags_campaign_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_hashtags_campaign_id" ON "public"."messaging_hashtags" USING "btree" ("campaign_id");

--
-- Name: idx_messaging_hashtags_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_hashtags_category" ON "public"."messaging_hashtags" USING "btree" ("category");

--
-- Name: idx_messaging_hashtags_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_hashtags_created_at" ON "public"."messaging_hashtags" USING "btree" ("created_at" DESC);

--
-- Name: idx_messaging_hashtags_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_hashtags_project_id" ON "public"."messaging_hashtags" USING "btree" ("project_id");

--
-- Name: idx_messaging_headlines_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_headlines_category" ON "public"."messaging_headlines" USING "btree" ("topic");

--
-- Name: idx_messaging_headlines_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_headlines_created_at" ON "public"."messaging_headlines" USING "btree" ("created_at" DESC);

--
-- Name: idx_messaging_headlines_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_headlines_project_id" ON "public"."messaging_headlines" USING "btree" ("project_id");

--
-- Name: idx_messaging_keywords_keyword; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_keywords_keyword" ON "public"."messaging_keywords" USING "btree" ("keyword");

--
-- Name: idx_messaging_keywords_keyword_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_messaging_keywords_keyword_topic" ON "public"."messaging_keywords" USING "btree" ("keyword", COALESCE("topic", ''::"text"));

--
-- Name: idx_messaging_keywords_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_keywords_project_id" ON "public"."messaging_keywords" USING "btree" ("project_id");

--
-- Name: idx_messaging_keywords_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_keywords_topic" ON "public"."messaging_keywords" USING "btree" ("topic");

--
-- Name: idx_messaging_pitches_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_pitches_category" ON "public"."messaging_pitches" USING "btree" ("topic");

--
-- Name: idx_messaging_pitches_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_pitches_created_at" ON "public"."messaging_pitches" USING "btree" ("created_at" DESC);

--
-- Name: idx_messaging_pitches_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_pitches_project_id" ON "public"."messaging_pitches" USING "btree" ("project_id");

--
-- Name: idx_messaging_posts_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_posts_category" ON "public"."messaging_posts" USING "btree" ("topic");

--
-- Name: idx_messaging_posts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_posts_created_at" ON "public"."messaging_posts" USING "btree" ("created_at" DESC);

--
-- Name: idx_messaging_posts_image_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_posts_image_asset_id" ON "public"."messaging_posts" USING "btree" ("image_asset_id");

--
-- Name: idx_messaging_posts_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_posts_project_id" ON "public"."messaging_posts" USING "btree" ("project_id");

--
-- Name: idx_messaging_posts_tagged_contact_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_posts_tagged_contact_id" ON "public"."messaging_posts" USING "btree" ("tagged_contact_id") WHERE (("tagged_contact_id" IS NOT NULL) AND (TRIM(BOTH FROM "tagged_contact_id") <> ''::"text"));

--
-- Name: idx_messaging_prompts_project_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_prompts_project_created" ON "public"."messaging_prompts" USING "btree" ("project_id", "created_at" DESC);

--
-- Name: idx_messaging_reports_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_reports_project_id" ON "public"."messaging_reports" USING "btree" ("project_id");

--
-- Name: idx_messaging_reports_publish_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_reports_publish_date" ON "public"."messaging_reports" USING "btree" ("publish_date" DESC NULLS LAST);

--
-- Name: idx_messaging_reports_thumbnail_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_reports_thumbnail_asset_id" ON "public"."messaging_reports" USING "btree" ("thumbnail_asset_id");

--
-- Name: idx_messaging_subheadings_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_subheadings_category" ON "public"."messaging_subheadings" USING "btree" ("topic");

--
-- Name: idx_messaging_subheadings_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_subheadings_created_at" ON "public"."messaging_subheadings" USING "btree" ("created_at" DESC);

--
-- Name: idx_messaging_subheadings_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_subheadings_project_id" ON "public"."messaging_subheadings" USING "btree" ("project_id");

--
-- Name: idx_messaging_subject_lines_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_subject_lines_category" ON "public"."messaging_subject_lines" USING "btree" ("category");

--
-- Name: idx_messaging_subject_lines_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_subject_lines_created_at" ON "public"."messaging_subject_lines" USING "btree" ("created_at" DESC);

--
-- Name: idx_messaging_taglines_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_taglines_category" ON "public"."messaging_taglines" USING "btree" ("topic");

--
-- Name: idx_messaging_taglines_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_taglines_created_at" ON "public"."messaging_taglines" USING "btree" ("created_at" DESC);

--
-- Name: idx_messaging_taglines_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_taglines_project_id" ON "public"."messaging_taglines" USING "btree" ("project_id");

--
-- Name: idx_messaging_tags_importance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_tags_importance" ON "public"."messaging_tags" USING "btree" ("importance");

--
-- Name: idx_messaging_tags_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_tags_project_id" ON "public"."messaging_tags" USING "btree" ("project_id");

--
-- Name: idx_messaging_tags_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_tags_tag" ON "public"."messaging_tags" USING "btree" ("tag");

--
-- Name: idx_messaging_tags_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_tags_topic" ON "public"."messaging_tags" USING "btree" ("topic");

--
-- Name: idx_messaging_topics_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_topics_project_id" ON "public"."messaging_topics" USING "btree" ("project_id");

--
-- Name: idx_messaging_topics_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_topics_topic" ON "public"."messaging_topics" USING "btree" ("topic");

--
-- Name: idx_messaging_transcripts_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_transcripts_category" ON "public"."messaging_transcripts" USING "btree" ("topic");

--
-- Name: idx_messaging_transcripts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_transcripts_created_at" ON "public"."messaging_transcripts" USING "btree" ("created_at" DESC);

--
-- Name: idx_messaging_transcripts_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_transcripts_project_id" ON "public"."messaging_transcripts" USING "btree" ("project_id");

--
-- Name: idx_messaging_tweets_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_tweets_category" ON "public"."messaging_tweets" USING "btree" ("topic");

--
-- Name: idx_messaging_tweets_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_tweets_created_at" ON "public"."messaging_tweets" USING "btree" ("created_at" DESC);

--
-- Name: idx_messaging_tweets_image_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_tweets_image_asset_id" ON "public"."messaging_tweets" USING "btree" ("image_asset_id");

--
-- Name: idx_messaging_tweets_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_tweets_project_id" ON "public"."messaging_tweets" USING "btree" ("project_id");

--
-- Name: idx_messaging_white_papers_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_white_papers_project_id" ON "public"."messaging_white_papers" USING "btree" ("project_id");

--
-- Name: idx_messaging_white_papers_publish_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_white_papers_publish_date" ON "public"."messaging_white_papers" USING "btree" ("publish_date" DESC NULLS LAST);

--
-- Name: idx_messaging_white_papers_thumbnail_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_white_papers_thumbnail_asset_id" ON "public"."messaging_white_papers" USING "btree" ("thumbnail_asset_id");

--
-- Name: idx_messaging_wyr_questions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_wyr_questions_created_at" ON "public"."messaging_wyr_questions" USING "btree" ("created_at" DESC);

--
-- Name: idx_messaging_wyr_questions_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_wyr_questions_project_id" ON "public"."messaging_wyr_questions" USING "btree" ("project_id");

--
-- Name: idx_messaging_wyr_questions_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_messaging_wyr_questions_topic" ON "public"."messaging_wyr_questions" USING "btree" ("topic");

--
-- Name: idx_object_associations_a_side; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_object_associations_a_side" ON "public"."object_associations" USING "btree" ("project_id", "a_type", "a_id");

--
-- Name: idx_object_associations_b_side; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_object_associations_b_side" ON "public"."object_associations" USING "btree" ("project_id", "b_type", "b_id");

--
-- Name: idx_object_associations_unique_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_object_associations_unique_pair" ON "public"."object_associations" USING "btree" ("a_type", "a_id", "b_type", "b_id", COALESCE("project_id", ''::"text"));

--
-- Name: idx_observe_page_views_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_observe_page_views_created_at" ON "public"."observe_page_views" USING "btree" ("created_at");

--
-- Name: idx_observe_page_views_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_observe_page_views_project_id" ON "public"."observe_page_views" USING "btree" ("project_id");

--
-- Name: idx_observe_usage_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_observe_usage_logs_created_at" ON "public"."observe_usage_logs" USING "btree" ("created_at");

--
-- Name: idx_observe_usage_logs_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_observe_usage_logs_project_id" ON "public"."observe_usage_logs" USING "btree" ("project_id");

--
-- Name: idx_observe_usage_logs_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_observe_usage_logs_provider" ON "public"."observe_usage_logs" USING "btree" ("provider");

--
-- Name: idx_orchestrator_runs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_orchestrator_runs_created" ON "public"."orchestrator_runs" USING "btree" ("project_id", "created_at" DESC);

--
-- Name: idx_people_auth_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_people_auth_user_id" ON "public"."people" USING "btree" ("auth_user_id");

--
-- Name: idx_people_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_people_email_lower" ON "public"."people" USING "btree" ("lower"("email")) WHERE (("email" IS NOT NULL) AND (TRIM(BOTH FROM "email") <> ''::"text"));

--
-- Name: idx_persona_harvests_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_persona_harvests_asset" ON "public"."influencer_persona_harvests" USING "btree" ("transformed_asset_id");

--
-- Name: idx_persona_harvests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_persona_harvests_status" ON "public"."influencer_persona_harvests" USING "btree" ("post_status");

--
-- Name: idx_project_admin_password_resets_admin_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_project_admin_password_resets_admin_user_id" ON "public"."app_project_admin_password_resets" USING "btree" ("admin_user_id");

--
-- Name: idx_project_admin_password_resets_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_project_admin_password_resets_expires_at" ON "public"."app_project_admin_password_resets" USING "btree" ("expires_at");

--
-- Name: idx_project_admin_password_resets_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_project_admin_password_resets_lookup" ON "public"."app_project_admin_password_resets" USING "btree" ("project_id", "email", "created_at" DESC);

--
-- Name: idx_project_admin_sessions_admin_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_project_admin_sessions_admin_user_id" ON "public"."app_project_admin_sessions" USING "btree" ("admin_user_id");

--
-- Name: idx_project_admin_sessions_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_project_admin_sessions_expires_at" ON "public"."app_project_admin_sessions" USING "btree" ("expires_at");

--
-- Name: idx_project_admin_sessions_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_project_admin_sessions_project_id" ON "public"."app_project_admin_sessions" USING "btree" ("project_id");

--
-- Name: idx_project_admin_users_project_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_project_admin_users_project_email" ON "public"."app_project_admin_users" USING "btree" ("project_id", "email");

--
-- Name: idx_project_admin_users_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_project_admin_users_project_id" ON "public"."app_project_admin_users" USING "btree" ("project_id");

--
-- Name: idx_project_oauth_handoffs_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_project_oauth_handoffs_expires" ON "public"."project_oauth_handoffs" USING "btree" ("expires_at");

--
-- Name: idx_project_social_credentials_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_project_social_credentials_updated" ON "public"."project_social_credentials" USING "btree" ("project_id", "updated_at" DESC);

--
-- Name: idx_project_support_requests_project_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_project_support_requests_project_created" ON "public"."app_project_support_requests" USING "btree" ("project_id", "created_at" DESC);

--
-- Name: idx_promo_lead_field_configs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_promo_lead_field_configs_active" ON "public"."promo_lead_field_configs" USING "btree" ("is_active", "position", "key");

--
-- Name: idx_reddit_harvest_runs_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_reddit_harvest_runs_project_id" ON "public"."reddit_harvest_runs" USING "btree" ("project_id");

--
-- Name: idx_segments_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_segments_project_id" ON "public"."segments" USING "btree" ("project_id");

--
-- Name: idx_site_import_assets_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_site_import_assets_job" ON "public"."app_site_import_assets" USING "btree" ("job_id", "status");

--
-- Name: idx_site_import_jobs_project_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_site_import_jobs_project_created" ON "public"."app_site_import_jobs" USING "btree" ("project_id", "created_at" DESC);

--
-- Name: idx_website_peers_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_website_peers_domain" ON "public"."website_peers" USING "btree" ("domain");

--
-- Name: idx_website_peers_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_website_peers_project_id" ON "public"."website_peers" USING "btree" ("project_id");

--
-- Name: idx_website_peers_project_site_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "idx_website_peers_project_site_scope" ON "public"."website_peers" USING "btree" ("project_id", "site_type", "source_domain", "domain");

--
-- Name: idx_website_peers_source_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_website_peers_source_domain" ON "public"."website_peers" USING "btree" ("source_domain");

--
-- Name: idx_x_harvest_runs_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_x_harvest_runs_project_id" ON "public"."x_harvest_runs" USING "btree" ("project_id");

--
-- Name: messaging_hashtags_campaign_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "messaging_hashtags_campaign_id_idx" ON "public"."messaging_hashtags" USING "btree" ("campaign_id");

--
-- Name: messaging_hashtags_hashtag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "messaging_hashtags_hashtag_idx" ON "public"."messaging_hashtags" USING "btree" ("hashtag");

--
-- Name: theme_wizard_candidates_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "theme_wizard_candidates_project_idx" ON "public"."theme_wizard_candidates" USING "btree" ("project_id");

--
-- Name: theme_wizard_candidates_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "theme_wizard_candidates_session_idx" ON "public"."theme_wizard_candidates" USING "btree" ("session_id", "round", "slot");

--
-- Name: theme_wizard_jobs_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "theme_wizard_jobs_session_idx" ON "public"."theme_wizard_jobs" USING "btree" ("session_id", "created_at" DESC);

--
-- Name: theme_wizard_jobs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "theme_wizard_jobs_status_idx" ON "public"."theme_wizard_jobs" USING "btree" ("status", "created_at");

--
-- Name: theme_wizard_library_entries_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "theme_wizard_library_entries_updated_idx" ON "public"."theme_wizard_library_entries" USING "btree" ("updated_at" DESC);

--
-- Name: theme_wizard_sessions_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "theme_wizard_sessions_project_idx" ON "public"."theme_wizard_sessions" USING "btree" ("project_id", "updated_at" DESC);

--
-- Name: training_rules_guides_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "training_rules_guides_user_idx" ON "public"."training_rules_guides" USING "btree" ("user_id", "sort_order", "type");

--
-- Name: training_settings_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "training_settings_updated_at_idx" ON "public"."training_settings" USING "btree" ("updated_at" DESC);

--
-- Name: training_taxonomy_user_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "training_taxonomy_user_kind_idx" ON "public"."training_taxonomy" USING "btree" ("user_id", "kind", "sort_order", "name");

--
-- Name: uq_content_items_legacy_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_content_items_legacy_ref" ON "public"."content_items" USING "btree" ("legacy_table", "legacy_id") WHERE (("legacy_table" <> ''::"text") AND ("legacy_id" IS NOT NULL));

--
-- Name: uq_content_items_project_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uq_content_items_project_source" ON "public"."content_items" USING "btree" ("project_id", "source_type", "source_id") WHERE (("source_type" <> ''::"text") AND ("source_id" <> ''::"text"));

--
-- Name: youtube_comment_runs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "youtube_comment_runs_created_at_idx" ON "public"."youtube_comment_runs" USING "btree" ("created_at" DESC);

--
-- Name: youtube_comment_runs_video_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "youtube_comment_runs_video_id_idx" ON "public"."youtube_comment_runs" USING "btree" ("video_id");

--
-- Name: contact_field_configs contact_field_configs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "contact_field_configs_set_updated_at" BEFORE UPDATE ON "public"."contact_field_configs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

--
-- Name: contact_personas contact_personas_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "contact_personas_set_updated_at" BEFORE UPDATE ON "public"."contact_personas" FOR EACH ROW EXECUTE FUNCTION "public"."set_contact_personas_updated_at"();

--
-- Name: contacts contacts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "contacts_set_updated_at" BEFORE UPDATE ON "public"."contacts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

--
-- Name: builder_extensions_manager set_builder_extensions_manager_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "set_builder_extensions_manager_updated_at" BEFORE UPDATE ON "public"."builder_extensions_manager" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at_timestamp"();

--
-- Name: builder_extensions set_builder_extensions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "set_builder_extensions_updated_at" BEFORE UPDATE ON "public"."builder_extensions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at_timestamp"();

--
-- Name: assets trg_assets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_assets_updated_at" BEFORE UPDATE ON "public"."assets" FOR EACH ROW EXECUTE FUNCTION "public"."set_assets_updated_at"();

--
-- Name: assets_video_curation trg_assets_video_curation_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_assets_video_curation_updated_at" BEFORE UPDATE ON "public"."assets_video_curation" FOR EACH ROW EXECUTE FUNCTION "public"."update_assets_video_curation_trigger"();

--
-- Name: blog_categories trg_blog_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_blog_categories_updated_at" BEFORE UPDATE ON "public"."blog_categories" FOR EACH ROW EXECUTE FUNCTION "public"."set_blog_categories_updated_at"();

--
-- Name: blog_posts trg_blog_posts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_blog_posts_updated_at" BEFORE UPDATE ON "public"."blog_posts" FOR EACH ROW EXECUTE FUNCTION "public"."set_blog_posts_updated_at"();

--
-- Name: builder_email_templates trg_builder_email_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_builder_email_templates_updated_at" BEFORE UPDATE ON "public"."builder_email_templates" FOR EACH ROW EXECUTE FUNCTION "public"."set_builder_email_templates_updated_at"();

--
-- Name: builder_forms trg_builder_forms_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_builder_forms_updated_at" BEFORE UPDATE ON "public"."builder_forms" FOR EACH ROW EXECUTE FUNCTION "public"."set_builder_forms_updated_at"();

--
-- Name: builder_landing_page trg_builder_landing_page_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_builder_landing_page_updated_at" BEFORE UPDATE ON "public"."builder_landing_page" FOR EACH ROW EXECUTE FUNCTION "public"."set_builder_landing_page_updated_at"();

--
-- Name: builder_module_classes trg_builder_module_classes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_builder_module_classes_updated_at" BEFORE UPDATE ON "public"."builder_module_classes" FOR EACH ROW EXECUTE FUNCTION "public"."set_builder_module_classes_updated_at"();

--
-- Name: builder_modules trg_builder_modules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_builder_modules_updated_at" BEFORE UPDATE ON "public"."builder_modules" FOR EACH ROW EXECUTE FUNCTION "public"."set_builder_modules_updated_at"();

--
-- Name: builder_page_templates trg_builder_page_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_builder_page_templates_updated_at" BEFORE UPDATE ON "public"."builder_page_templates" FOR EACH ROW EXECUTE FUNCTION "public"."set_builder_page_templates_updated_at"();

--
-- Name: builder_products trg_builder_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_builder_products_updated_at" BEFORE UPDATE ON "public"."builder_products" FOR EACH ROW EXECUTE FUNCTION "public"."set_builder_products_updated_at"();

--
-- Name: builder_saved_sections trg_builder_saved_sections_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_builder_saved_sections_updated_at" BEFORE UPDATE ON "public"."builder_saved_sections" FOR EACH ROW EXECUTE FUNCTION "public"."set_builder_saved_sections_updated_at"();

--
-- Name: content_items trg_content_items_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_content_items_set_updated_at" BEFORE UPDATE ON "public"."content_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at_now"();

--
-- Name: content_items trg_content_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_content_items_updated_at" BEFORE UPDATE ON "public"."content_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_content_items_updated_at"();

--
-- Name: content_types trg_content_types_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_content_types_set_updated_at" BEFORE UPDATE ON "public"."content_types" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at_now"();

--
-- Name: messaging_articles trg_messaging_articles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_articles_updated_at" BEFORE UPDATE ON "public"."messaging_articles" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_articles_updated_at"();

--
-- Name: messaging_comments trg_messaging_comments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_comments_updated_at" BEFORE UPDATE ON "public"."messaging_comments" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_comments_updated_at"();

--
-- Name: messaging_content_items trg_messaging_content_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_content_items_updated_at" BEFORE UPDATE ON "public"."messaging_content_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_content_items_updated_at"();

--
-- Name: messaging_content_types trg_messaging_content_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_content_types_updated_at" BEFORE UPDATE ON "public"."messaging_content_types" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_content_types_updated_at"();

--
-- Name: messaging_ctas trg_messaging_ctas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_ctas_updated_at" BEFORE UPDATE ON "public"."messaging_ctas" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_ctas_updated_at"();

--
-- Name: messaging_descriptions trg_messaging_descriptions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_descriptions_updated_at" BEFORE UPDATE ON "public"."messaging_descriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_descriptions_updated_at"();

--
-- Name: messaging_ebooks trg_messaging_ebooks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_ebooks_updated_at" BEFORE UPDATE ON "public"."messaging_ebooks" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_ebooks_updated_at"();

--
-- Name: messaging_emails trg_messaging_emails_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_emails_updated_at" BEFORE UPDATE ON "public"."messaging_emails" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_emails_updated_at"();

--
-- Name: messaging_formats trg_messaging_formats_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_formats_updated_at" BEFORE UPDATE ON "public"."messaging_formats" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_formats_updated_at"();

--
-- Name: messaging_hashtags trg_messaging_hashtags_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_hashtags_updated_at" BEFORE UPDATE ON "public"."messaging_hashtags" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_hashtags_updated_at"();

--
-- Name: messaging_headlines trg_messaging_headlines_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_headlines_updated_at" BEFORE UPDATE ON "public"."messaging_headlines" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_headlines_updated_at"();

--
-- Name: messaging_keywords trg_messaging_keywords_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_keywords_updated_at" BEFORE UPDATE ON "public"."messaging_keywords" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_keywords_updated_at"();

--
-- Name: messaging_pitches trg_messaging_pitches_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_pitches_updated_at" BEFORE UPDATE ON "public"."messaging_pitches" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_pitches_updated_at"();

--
-- Name: messaging_posts trg_messaging_posts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_posts_updated_at" BEFORE UPDATE ON "public"."messaging_posts" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_posts_updated_at"();

--
-- Name: messaging_prompts trg_messaging_prompts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_prompts_updated_at" BEFORE UPDATE ON "public"."messaging_prompts" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_prompts_updated_at"();

--
-- Name: messaging_reports trg_messaging_reports_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_reports_updated_at" BEFORE UPDATE ON "public"."messaging_reports" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_reports_updated_at"();

--
-- Name: messaging_subheadings trg_messaging_subheadings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_subheadings_updated_at" BEFORE UPDATE ON "public"."messaging_subheadings" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_subheadings_updated_at"();

--
-- Name: messaging_subject_lines trg_messaging_subject_lines_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_subject_lines_updated_at" BEFORE UPDATE ON "public"."messaging_subject_lines" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_subject_lines_updated_at"();

--
-- Name: messaging_taglines trg_messaging_taglines_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_taglines_updated_at" BEFORE UPDATE ON "public"."messaging_taglines" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_taglines_updated_at"();

--
-- Name: messaging_tags trg_messaging_tags_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_tags_updated_at" BEFORE UPDATE ON "public"."messaging_tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_tags_updated_at"();

--
-- Name: messaging_topics trg_messaging_topics_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_topics_updated_at" BEFORE UPDATE ON "public"."messaging_topics" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_topics_updated_at"();

--
-- Name: messaging_transcripts trg_messaging_transcripts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_transcripts_updated_at" BEFORE UPDATE ON "public"."messaging_transcripts" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_transcripts_updated_at"();

--
-- Name: messaging_tweets trg_messaging_tweets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_tweets_updated_at" BEFORE UPDATE ON "public"."messaging_tweets" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_tweets_updated_at"();

--
-- Name: messaging_white_papers trg_messaging_white_papers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_white_papers_updated_at" BEFORE UPDATE ON "public"."messaging_white_papers" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_white_papers_updated_at"();

--
-- Name: messaging_wyr_questions trg_messaging_wyr_questions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_messaging_wyr_questions_updated_at" BEFORE UPDATE ON "public"."messaging_wyr_questions" FOR EACH ROW EXECUTE FUNCTION "public"."set_messaging_wyr_questions_updated_at"();

--
-- Name: app_project_admin_users trg_project_admin_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_project_admin_users_updated_at" BEFORE UPDATE ON "public"."app_project_admin_users" FOR EACH ROW EXECUTE FUNCTION "public"."set_project_admin_users_updated_at"();

--
-- Name: builder_themes trg_set_develop_themes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_set_develop_themes_updated_at" BEFORE UPDATE ON "public"."builder_themes" FOR EACH ROW EXECUTE FUNCTION "public"."set_develop_themes_updated_at"();

--
-- Name: website_peers trg_website_peers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trg_website_peers_updated_at" BEFORE UPDATE ON "public"."website_peers" FOR EACH ROW EXECUTE FUNCTION "public"."set_website_peers_updated_at"();

--
-- Name: acquire_job_mirror acquire_job_mirror_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."acquire_job_mirror"
    ADD CONSTRAINT "acquire_job_mirror_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE CASCADE;

--
-- Name: agent_messages agent_messages_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."agent_messages"
    ADD CONSTRAINT "agent_messages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."agent_messages"("id") ON DELETE CASCADE;

--
-- Name: app_auth_sessions app_auth_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_auth_sessions"
    ADD CONSTRAINT "app_auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."app_auth_users"("id") ON DELETE CASCADE;

--
-- Name: app_invitations app_invitations_accepted_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_invitations"
    ADD CONSTRAINT "app_invitations_accepted_user_id_fkey" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."app_auth_users"("id") ON DELETE SET NULL;

--
-- Name: app_invitations app_invitations_invited_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_invitations"
    ADD CONSTRAINT "app_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."app_auth_users"("id") ON DELETE CASCADE;

--
-- Name: app_project_admin_password_resets app_project_admin_password_resets_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_project_admin_password_resets"
    ADD CONSTRAINT "app_project_admin_password_resets_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."app_project_admin_users"("id") ON DELETE CASCADE;

--
-- Name: app_project_admin_sessions app_project_admin_sessions_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_project_admin_sessions"
    ADD CONSTRAINT "app_project_admin_sessions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."app_project_admin_users"("id") ON DELETE CASCADE;

--
-- Name: app_project_memberships app_project_memberships_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_project_memberships"
    ADD CONSTRAINT "app_project_memberships_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE CASCADE;

--
-- Name: app_site_import_assets app_site_import_assets_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_site_import_assets"
    ADD CONSTRAINT "app_site_import_assets_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."app_site_import_jobs"("id") ON DELETE CASCADE;

--
-- Name: app_site_import_jobs app_site_import_jobs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."app_site_import_jobs"
    ADD CONSTRAINT "app_site_import_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE CASCADE;

--
-- Name: asset_categories asset_categories_parent_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."asset_categories"
    ADD CONSTRAINT "asset_categories_parent_category_id_fkey" FOREIGN KEY ("parent_category_id") REFERENCES "public"."asset_categories"("id") ON DELETE SET NULL;

--
-- Name: blog_post_categories blog_post_categories_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."blog_post_categories"
    ADD CONSTRAINT "blog_post_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."blog_categories"("id") ON DELETE CASCADE;

--
-- Name: blog_post_categories blog_post_categories_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."blog_post_categories"
    ADD CONSTRAINT "blog_post_categories_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE CASCADE;

--
-- Name: builder_poll_options builder_poll_options_poll_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_poll_options"
    ADD CONSTRAINT "builder_poll_options_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "public"."builder_polls"("id") ON DELETE CASCADE;

--
-- Name: builder_poll_responses builder_poll_responses_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_poll_responses"
    ADD CONSTRAINT "builder_poll_responses_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "public"."builder_poll_options"("id") ON DELETE CASCADE;

--
-- Name: builder_poll_responses builder_poll_responses_poll_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_poll_responses"
    ADD CONSTRAINT "builder_poll_responses_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "public"."builder_polls"("id") ON DELETE CASCADE;

--
-- Name: campaign_events campaign_events_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."campaign_events"
    ADD CONSTRAINT "campaign_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;

--
-- Name: campaigns campaigns_segment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE SET NULL;

--
-- Name: channels channels_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."channels"
    ADD CONSTRAINT "channels_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL;

--
-- Name: connection_ops_state connection_ops_state_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."connection_ops_state"
    ADD CONSTRAINT "connection_ops_state_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE CASCADE;

--
-- Name: contact_field_configs contact_field_configs_contact_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contact_field_configs"
    ADD CONSTRAINT "contact_field_configs_contact_type_fkey" FOREIGN KEY ("contact_type") REFERENCES "public"."contact_types"("key") ON UPDATE CASCADE;

--
-- Name: contacts contacts_contact_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_contact_type_fkey" FOREIGN KEY ("contact_type") REFERENCES "public"."contact_types"("key") ON UPDATE CASCADE;

--
-- Name: contacts contacts_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE RESTRICT;

--
-- Name: content_item_assets content_item_assets_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."content_item_assets"
    ADD CONSTRAINT "content_item_assets_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE;

--
-- Name: content_items content_items_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."content_items"
    ADD CONSTRAINT "content_items_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "public"."content_types"("id") ON DELETE RESTRICT;

--
-- Name: dev_message_links dev_message_links_source_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_message_links"
    ADD CONSTRAINT "dev_message_links_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "public"."agent_messages"("id") ON DELETE CASCADE;

--
-- Name: dev_project_members dev_project_members_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_project_members"
    ADD CONSTRAINT "dev_project_members_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;

--
-- Name: dev_project_members dev_project_members_dev_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_project_members"
    ADD CONSTRAINT "dev_project_members_dev_project_id_fkey" FOREIGN KEY ("dev_project_id") REFERENCES "public"."dev_projects"("id") ON DELETE CASCADE;

--
-- Name: dev_tasks dev_tasks_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_tasks"
    ADD CONSTRAINT "dev_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."dev_projects"("id") ON DELETE SET NULL;

--
-- Name: dev_tasks dev_tasks_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_tasks"
    ADD CONSTRAINT "dev_tasks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."dev_sessions"("id") ON DELETE SET NULL;

--
-- Name: dev_team dev_team_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."dev_team"
    ADD CONSTRAINT "dev_team_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;

--
-- Name: builder_extensions develop_extensions_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_extensions"
    ADD CONSTRAINT "develop_extensions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."builder_extensions"("id") ON DELETE SET NULL;

--
-- Name: builder_icons develop_icons_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_icons"
    ADD CONSTRAINT "develop_icons_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE CASCADE;

--
-- Name: builder_modules fk_develop_modules_class_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."builder_modules"
    ADD CONSTRAINT "fk_develop_modules_class_id" FOREIGN KEY ("class_id") REFERENCES "public"."builder_module_classes"("id") ON DELETE SET NULL;

--
-- Name: messaging_articles fk_messaging_articles_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_articles"
    ADD CONSTRAINT "fk_messaging_articles_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_comments fk_messaging_comments_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_comments"
    ADD CONSTRAINT "fk_messaging_comments_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_ctas fk_messaging_ctas_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_ctas"
    ADD CONSTRAINT "fk_messaging_ctas_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_descriptions fk_messaging_descriptions_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_descriptions"
    ADD CONSTRAINT "fk_messaging_descriptions_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_ebooks fk_messaging_ebooks_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_ebooks"
    ADD CONSTRAINT "fk_messaging_ebooks_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_emails fk_messaging_emails_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_emails"
    ADD CONSTRAINT "fk_messaging_emails_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_formats fk_messaging_formats_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_formats"
    ADD CONSTRAINT "fk_messaging_formats_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_hashtags fk_messaging_hashtags_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_hashtags"
    ADD CONSTRAINT "fk_messaging_hashtags_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_headlines fk_messaging_headlines_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_headlines"
    ADD CONSTRAINT "fk_messaging_headlines_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_keywords fk_messaging_keywords_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_keywords"
    ADD CONSTRAINT "fk_messaging_keywords_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_pitches fk_messaging_pitches_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_pitches"
    ADD CONSTRAINT "fk_messaging_pitches_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_posts fk_messaging_posts_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_posts"
    ADD CONSTRAINT "fk_messaging_posts_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_prompts fk_messaging_prompts_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_prompts"
    ADD CONSTRAINT "fk_messaging_prompts_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_reports fk_messaging_reports_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_reports"
    ADD CONSTRAINT "fk_messaging_reports_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_subheadings fk_messaging_subheadings_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_subheadings"
    ADD CONSTRAINT "fk_messaging_subheadings_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_taglines fk_messaging_taglines_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_taglines"
    ADD CONSTRAINT "fk_messaging_taglines_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_tags fk_messaging_tags_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_tags"
    ADD CONSTRAINT "fk_messaging_tags_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_topics fk_messaging_topics_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_topics"
    ADD CONSTRAINT "fk_messaging_topics_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_transcripts fk_messaging_transcripts_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_transcripts"
    ADD CONSTRAINT "fk_messaging_transcripts_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_tweets fk_messaging_tweets_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_tweets"
    ADD CONSTRAINT "fk_messaging_tweets_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: messaging_white_papers fk_messaging_white_papers_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_white_papers"
    ADD CONSTRAINT "fk_messaging_white_papers_project_id" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE SET NULL;

--
-- Name: game_level_events game_level_events_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."game_level_events"
    ADD CONSTRAINT "game_level_events_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."builder_modules"("id") ON DELETE SET NULL;

--
-- Name: influencer_persona_harvests influencer_persona_harvests_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."influencer_persona_harvests"
    ADD CONSTRAINT "influencer_persona_harvests_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "public"."influencer_personas"("id") ON DELETE CASCADE;

--
-- Name: memories memories_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."memories"
    ADD CONSTRAINT "memories_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;

--
-- Name: messaging_articles messaging_articles_thumbnail_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_articles"
    ADD CONSTRAINT "messaging_articles_thumbnail_asset_id_fkey" FOREIGN KEY ("thumbnail_asset_id") REFERENCES "public"."assets"("id") ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: messaging_ebooks messaging_ebooks_thumbnail_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_ebooks"
    ADD CONSTRAINT "messaging_ebooks_thumbnail_asset_id_fkey" FOREIGN KEY ("thumbnail_asset_id") REFERENCES "public"."assets"("id") ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: messaging_posts messaging_posts_image_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_posts"
    ADD CONSTRAINT "messaging_posts_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "public"."assets"("id") ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: messaging_reports messaging_reports_thumbnail_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_reports"
    ADD CONSTRAINT "messaging_reports_thumbnail_asset_id_fkey" FOREIGN KEY ("thumbnail_asset_id") REFERENCES "public"."assets"("id") ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: messaging_tweets messaging_tweets_image_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_tweets"
    ADD CONSTRAINT "messaging_tweets_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "public"."assets"("id") ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: messaging_white_papers messaging_white_papers_thumbnail_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."messaging_white_papers"
    ADD CONSTRAINT "messaging_white_papers_thumbnail_asset_id_fkey" FOREIGN KEY ("thumbnail_asset_id") REFERENCES "public"."assets"("id") ON UPDATE CASCADE ON DELETE SET NULL;

--
-- Name: observe_page_views observe_page_views_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."observe_page_views"
    ADD CONSTRAINT "observe_page_views_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE CASCADE;

--
-- Name: observe_usage_logs observe_usage_logs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."observe_usage_logs"
    ADD CONSTRAINT "observe_usage_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE CASCADE;

--
-- Name: orchestrator_runs orchestrator_runs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."orchestrator_runs"
    ADD CONSTRAINT "orchestrator_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE CASCADE;

--
-- Name: people people_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."people"
    ADD CONSTRAINT "people_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "public"."app_auth_users"("id") ON DELETE SET NULL;

--
-- Name: project_oauth_handoffs project_oauth_handoffs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."project_oauth_handoffs"
    ADD CONSTRAINT "project_oauth_handoffs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE CASCADE;

--
-- Name: project_social_credentials project_social_credentials_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."project_social_credentials"
    ADD CONSTRAINT "project_social_credentials_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE CASCADE;

--
-- Name: agent_messages roger_chats_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."agent_messages"
    ADD CONSTRAINT "roger_chats_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."dev_sessions"("id") ON DELETE CASCADE;

--
-- Name: theme_wizard_candidates theme_wizard_candidates_parent_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."theme_wizard_candidates"
    ADD CONSTRAINT "theme_wizard_candidates_parent_candidate_id_fkey" FOREIGN KEY ("parent_candidate_id") REFERENCES "public"."theme_wizard_candidates"("id") ON DELETE SET NULL;

--
-- Name: theme_wizard_candidates theme_wizard_candidates_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."theme_wizard_candidates"
    ADD CONSTRAINT "theme_wizard_candidates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE CASCADE;

--
-- Name: theme_wizard_candidates theme_wizard_candidates_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."theme_wizard_candidates"
    ADD CONSTRAINT "theme_wizard_candidates_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."theme_wizard_sessions"("id") ON DELETE CASCADE;

--
-- Name: theme_wizard_jobs theme_wizard_jobs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."theme_wizard_jobs"
    ADD CONSTRAINT "theme_wizard_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE CASCADE;

--
-- Name: theme_wizard_jobs theme_wizard_jobs_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."theme_wizard_jobs"
    ADD CONSTRAINT "theme_wizard_jobs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."theme_wizard_sessions"("id") ON DELETE CASCADE;

--
-- Name: theme_wizard_sessions theme_wizard_sessions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."theme_wizard_sessions"
    ADD CONSTRAINT "theme_wizard_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE CASCADE;

--
-- Name: app_invitations Allow all access on app invitations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all access on app invitations" ON "public"."app_invitations" USING (true) WITH CHECK (true);

--
-- Name: dev_project_members Allow all access on dev project members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all access on dev project members" ON "public"."dev_project_members" USING (true) WITH CHECK (true);

--
-- Name: dev_projects Allow all access on dev projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all access on dev projects" ON "public"."dev_projects" USING (true) WITH CHECK (true);

--
-- Name: dev_roles Allow all access on dev roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all access on dev roles" ON "public"."dev_roles" USING (true) WITH CHECK (true);

--
-- Name: dev_tasks Allow all access on dev tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all access on dev tasks" ON "public"."dev_tasks" USING (true) WITH CHECK (true);

--
-- Name: dev_team Allow all access on dev team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all access on dev team" ON "public"."dev_team" USING (true) WITH CHECK (true);

--
-- Name: dev_friction_logs Allow all access on friction logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all access on friction logs" ON "public"."dev_friction_logs" USING (true) WITH CHECK (true);

--
-- Name: people Allow all access on people; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all access on people" ON "public"."people" USING (true) WITH CHECK (true);

--
-- Name: training_corpus Allow all access on training corpus; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all access on training corpus" ON "public"."training_corpus" USING (true) WITH CHECK (true);

--
-- Name: acquire_youtube_videos Allow anon delete acquire_youtube_videos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow anon delete acquire_youtube_videos" ON "public"."acquire_youtube_videos" FOR DELETE USING (true);

--
-- Name: acquire_youtube_videos Allow anon insert acquire_youtube_videos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow anon insert acquire_youtube_videos" ON "public"."acquire_youtube_videos" FOR INSERT WITH CHECK (true);

--
-- Name: acquire_youtube_videos Allow anon update acquire_youtube_videos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow anon update acquire_youtube_videos" ON "public"."acquire_youtube_videos" FOR UPDATE USING (true) WITH CHECK (true);

--
-- Name: agent_messages Allow authenticated read/write/delete access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow authenticated read/write/delete access" ON "public"."agent_messages" TO "authenticated" USING (true) WITH CHECK (true);

--
-- Name: dev_sessions Allow authenticated read/write/delete access on sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow authenticated read/write/delete access on sessions" ON "public"."dev_sessions" TO "authenticated" USING (true) WITH CHECK (true);

--
-- Name: acquire_youtube_videos Allow public read access to acquire_youtube_videos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to acquire_youtube_videos" ON "public"."acquire_youtube_videos" FOR SELECT USING (true);

--
-- Name: agent_messages Allow public read access to agent_messages for realtime; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to agent_messages for realtime" ON "public"."agent_messages" FOR SELECT USING (true);

--
-- Name: promo_memories Enable read/write for service role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable read/write for service role" ON "public"."promo_memories" TO "service_role" USING (true) WITH CHECK (true);

--
-- Name: influencer_persona_harvests Harvest blocks are bound dynamically to persona structure; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Harvest blocks are bound dynamically to persona structure" ON "public"."influencer_persona_harvests" USING ((EXISTS ( SELECT 1
   FROM "public"."influencer_personas" "p"
  WHERE (("p"."id" = "influencer_persona_harvests"."persona_id") AND ("p"."owner_id" = ("auth"."uid"())::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."influencer_personas" "p"
  WHERE (("p"."id" = "influencer_persona_harvests"."persona_id") AND ("p"."owner_id" = ("auth"."uid"())::"text")))));

--
-- Name: assets_video_curation Service Role All Access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service Role All Access" ON "public"."assets_video_curation" USING (true) WITH CHECK (true);

--
-- Name: observe_page_views Users can insert page views for their project.; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert page views for their project." ON "public"."observe_page_views" FOR INSERT WITH CHECK (((("auth"."uid"())::"text" = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."app_project_memberships"
  WHERE (("app_project_memberships"."project_id" = "observe_page_views"."project_id") AND ("app_project_memberships"."user_id" = ("auth"."uid"())::"text"))))));

--
-- Name: observe_usage_logs Users can only read and append usage logs connected to their sc; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can only read and append usage logs connected to their sc" ON "public"."observe_usage_logs" USING (((("auth"."uid"())::"text" = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."app_project_memberships"
  WHERE (("app_project_memberships"."project_id" = "observe_usage_logs"."project_id") AND ("app_project_memberships"."user_id" = ("auth"."uid"())::"text"))))));

--
-- Name: observe_page_views Users can read page views for their project.; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read page views for their project." ON "public"."observe_page_views" FOR SELECT USING (((("auth"."uid"())::"text" = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."app_project_memberships"
  WHERE (("app_project_memberships"."project_id" = "observe_page_views"."project_id") AND ("app_project_memberships"."user_id" = ("auth"."uid"())::"text"))))));

--
-- Name: influencer_personas Users govern their own proxy personas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users govern their own proxy personas" ON "public"."influencer_personas" USING ((("auth"."uid"())::"text" = "owner_id")) WITH CHECK ((("auth"."uid"())::"text" = "owner_id"));

--
-- Name: acquire_job_mirror; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."acquire_job_mirror" ENABLE ROW LEVEL SECURITY;

--
-- Name: acquire_youtube_comment_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."acquire_youtube_comment_records" ENABLE ROW LEVEL SECURITY;

--
-- Name: acquire_youtube_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."acquire_youtube_comments" ENABLE ROW LEVEL SECURITY;

--
-- Name: acquire_youtube_details; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."acquire_youtube_details" ENABLE ROW LEVEL SECURITY;

--
-- Name: acquire_youtube_topics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."acquire_youtube_topics" ENABLE ROW LEVEL SECURITY;

--
-- Name: acquire_youtube_videos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."acquire_youtube_videos" ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."activity_log" ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."agent_messages" ENABLE ROW LEVEL SECURITY;

--
-- Name: app_auth_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."app_auth_sessions" ENABLE ROW LEVEL SECURITY;

--
-- Name: app_auth_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."app_auth_users" ENABLE ROW LEVEL SECURITY;

--
-- Name: app_credential_identities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."app_credential_identities" ENABLE ROW LEVEL SECURITY;

--
-- Name: app_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."app_invitations" ENABLE ROW LEVEL SECURITY;

--
-- Name: app_project_admin_password_resets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."app_project_admin_password_resets" ENABLE ROW LEVEL SECURITY;

--
-- Name: app_project_admin_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."app_project_admin_sessions" ENABLE ROW LEVEL SECURITY;

--
-- Name: app_project_admin_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."app_project_admin_users" ENABLE ROW LEVEL SECURITY;

--
-- Name: app_project_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."app_project_memberships" ENABLE ROW LEVEL SECURITY;

--
-- Name: app_project_support_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."app_project_support_requests" ENABLE ROW LEVEL SECURITY;

--
-- Name: app_projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."app_projects" ENABLE ROW LEVEL SECURITY;

--
-- Name: app_site_import_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."app_site_import_assets" ENABLE ROW LEVEL SECURITY;

--
-- Name: app_site_import_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."app_site_import_jobs" ENABLE ROW LEVEL SECURITY;

--
-- Name: asset_associations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."asset_associations" ENABLE ROW LEVEL SECURITY;

--
-- Name: asset_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."asset_categories" ENABLE ROW LEVEL SECURITY;

--
-- Name: assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."assets" ENABLE ROW LEVEL SECURITY;

--
-- Name: assets_video_curation; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."assets_video_curation" ENABLE ROW LEVEL SECURITY;

--
-- Name: blog_card_template; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."blog_card_template" ENABLE ROW LEVEL SECURITY;

--
-- Name: blog_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."blog_categories" ENABLE ROW LEVEL SECURITY;

--
-- Name: blog_post_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."blog_post_categories" ENABLE ROW LEVEL SECURITY;

--
-- Name: blog_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."blog_posts" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_clusters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_clusters" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_email_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_email_templates" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_extensions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_extensions" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_extensions_manager; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_extensions_manager" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_forms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_forms" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_icons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_icons" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_landing_page; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_landing_page" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_landing_page_marinoff_bak_20260717; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_landing_page_marinoff_bak_20260717" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_module_classes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_module_classes" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_modules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_modules" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_page_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_page_revisions" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_page_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_page_snapshots" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_page_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_page_templates" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_poll_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_poll_options" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_poll_responses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_poll_responses" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_polls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_polls" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_products" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_published_pages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_published_pages" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_saved_sections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_saved_sections" ENABLE ROW LEVEL SECURITY;

--
-- Name: builder_themes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."builder_themes" ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."campaign_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;

--
-- Name: channels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."channels" ENABLE ROW LEVEL SECURITY;

--
-- Name: connection_ops_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."connection_ops_state" ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_field_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."contact_field_configs" ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_personas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."contact_personas" ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_project_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."contact_project_invitations" ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."contact_sources" ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_statuses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."contact_statuses" ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."contact_types" ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;

--
-- Name: content_item_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."content_item_assets" ENABLE ROW LEVEL SECURITY;

--
-- Name: content_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."content_items" ENABLE ROW LEVEL SECURITY;

--
-- Name: content_transform_handlers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."content_transform_handlers" ENABLE ROW LEVEL SECURITY;

--
-- Name: content_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."content_types" ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."crm_configs" ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."crm_contacts" ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_forms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."crm_forms" ENABLE ROW LEVEL SECURITY;

--
-- Name: dev_friction_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."dev_friction_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: dev_message_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."dev_message_links" ENABLE ROW LEVEL SECURITY;

--
-- Name: dev_project_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."dev_project_members" ENABLE ROW LEVEL SECURITY;

--
-- Name: dev_projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."dev_projects" ENABLE ROW LEVEL SECURITY;

--
-- Name: dev_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."dev_roles" ENABLE ROW LEVEL SECURITY;

--
-- Name: dev_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."dev_sessions" ENABLE ROW LEVEL SECURITY;

--
-- Name: dev_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."dev_tasks" ENABLE ROW LEVEL SECURITY;

--
-- Name: dev_team; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."dev_team" ENABLE ROW LEVEL SECURITY;

--
-- Name: direct_acquire_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."direct_acquire_runs" ENABLE ROW LEVEL SECURITY;

--
-- Name: engage_social_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."engage_social_posts" ENABLE ROW LEVEL SECURITY;

--
-- Name: engage_youtube_comment_agents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."engage_youtube_comment_agents" ENABLE ROW LEVEL SECURITY;

--
-- Name: game_level_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."game_level_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: game_level_tiers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."game_level_tiers" ENABLE ROW LEVEL SECURITY;

--
-- Name: game_level_up_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."game_level_up_rules" ENABLE ROW LEVEL SECURITY;

--
-- Name: game_levels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."game_levels" ENABLE ROW LEVEL SECURITY;

--
-- Name: game_progressive_features; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."game_progressive_features" ENABLE ROW LEVEL SECURITY;

--
-- Name: game_rewards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."game_rewards" ENABLE ROW LEVEL SECURITY;

--
-- Name: game_scoring; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."game_scoring" ENABLE ROW LEVEL SECURITY;

--
-- Name: influencer_persona_harvests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."influencer_persona_harvests" ENABLE ROW LEVEL SECURITY;

--
-- Name: influencer_personas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."influencer_personas" ENABLE ROW LEVEL SECURITY;

--
-- Name: leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;

--
-- Name: memories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."memories" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_articles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_articles" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_comments" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_content_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_content_items" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_content_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_content_types" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_ctas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_ctas" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_descriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_descriptions" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_ebooks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_ebooks" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_emails" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_formats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_formats" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_hashtags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_hashtags" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_headlines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_headlines" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_keywords; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_keywords" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_pitches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_pitches" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_posts" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_prompts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_prompts" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_reports" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_subheadings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_subheadings" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_subject_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_subject_lines" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_taglines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_taglines" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_tags" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_topics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_topics" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_transcripts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_transcripts" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_tweets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_tweets" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_white_papers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_white_papers" ENABLE ROW LEVEL SECURITY;

--
-- Name: messaging_wyr_questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messaging_wyr_questions" ENABLE ROW LEVEL SECURITY;

--
-- Name: object_associations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."object_associations" ENABLE ROW LEVEL SECURITY;

--
-- Name: observe_page_views; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."observe_page_views" ENABLE ROW LEVEL SECURITY;

--
-- Name: observe_usage_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."observe_usage_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: orchestrator_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."orchestrator_runs" ENABLE ROW LEVEL SECURITY;

--
-- Name: people; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."people" ENABLE ROW LEVEL SECURITY;

--
-- Name: project_oauth_handoffs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."project_oauth_handoffs" ENABLE ROW LEVEL SECURITY;

--
-- Name: project_social_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."project_social_credentials" ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_lead_field_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."promo_lead_field_configs" ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_memories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."promo_memories" ENABLE ROW LEVEL SECURITY;

--
-- Name: reddit_harvest_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."reddit_harvest_runs" ENABLE ROW LEVEL SECURITY;

--
-- Name: segment_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."segment_types" ENABLE ROW LEVEL SECURITY;

--
-- Name: segments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."segments" ENABLE ROW LEVEL SECURITY;

--
-- Name: acquire_job_mirror starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."acquire_job_mirror" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: acquire_youtube_videos starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."acquire_youtube_videos" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: agent_messages starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."agent_messages" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: app_credential_identities starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."app_credential_identities" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: app_invitations starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."app_invitations" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: app_project_admin_password_resets starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."app_project_admin_password_resets" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: app_project_admin_sessions starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."app_project_admin_sessions" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: app_project_admin_users starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."app_project_admin_users" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: app_project_support_requests starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."app_project_support_requests" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: app_site_import_assets starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."app_site_import_assets" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: app_site_import_jobs starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."app_site_import_jobs" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: asset_associations starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."asset_associations" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: assets_video_curation starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."assets_video_curation" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: blog_card_template starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."blog_card_template" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: blog_categories starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."blog_categories" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: blog_post_categories starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."blog_post_categories" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: blog_posts starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."blog_posts" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: builder_clusters starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."builder_clusters" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: builder_icons starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."builder_icons" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: builder_landing_page_marinoff_bak_20260717 starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."builder_landing_page_marinoff_bak_20260717" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: builder_module_classes starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."builder_module_classes" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: builder_page_revisions starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."builder_page_revisions" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: builder_page_snapshots starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."builder_page_snapshots" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: builder_poll_options starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."builder_poll_options" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: builder_poll_responses starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."builder_poll_responses" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: builder_polls starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."builder_polls" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: builder_products starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."builder_products" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: builder_published_pages starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."builder_published_pages" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: builder_saved_sections starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."builder_saved_sections" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: connection_ops_state starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."connection_ops_state" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: contact_project_invitations starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."contact_project_invitations" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: content_items starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."content_items" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: content_transform_handlers starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."content_transform_handlers" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: crm_configs starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."crm_configs" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: crm_contacts starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."crm_contacts" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: crm_forms starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."crm_forms" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: dev_friction_logs starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."dev_friction_logs" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: dev_message_links starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."dev_message_links" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: dev_project_members starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."dev_project_members" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: dev_projects starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."dev_projects" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: dev_roles starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."dev_roles" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: dev_sessions starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."dev_sessions" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: dev_tasks starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."dev_tasks" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: dev_team starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."dev_team" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: direct_acquire_runs starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."direct_acquire_runs" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: engage_social_posts starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."engage_social_posts" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: game_level_events starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."game_level_events" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: game_level_tiers starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."game_level_tiers" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: game_level_up_rules starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."game_level_up_rules" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: game_levels starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."game_levels" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: game_progressive_features starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."game_progressive_features" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: game_rewards starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."game_rewards" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: game_scoring starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."game_scoring" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: influencer_persona_harvests starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."influencer_persona_harvests" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: influencer_personas starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."influencer_personas" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: messaging_wyr_questions starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."messaging_wyr_questions" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: object_associations starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."object_associations" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: observe_page_views starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."observe_page_views" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: observe_usage_logs starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."observe_usage_logs" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: orchestrator_runs starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."orchestrator_runs" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: people starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."people" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: project_oauth_handoffs starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."project_oauth_handoffs" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: project_social_credentials starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."project_social_credentials" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: promo_memories starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."promo_memories" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: reddit_harvest_runs starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."reddit_harvest_runs" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: theme_wizard_candidates starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."theme_wizard_candidates" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: theme_wizard_jobs starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."theme_wizard_jobs" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: theme_wizard_library_entries starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."theme_wizard_library_entries" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: theme_wizard_sessions starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."theme_wizard_sessions" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: training_corpus starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."training_corpus" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: x_harvest_runs starcaster_readonly_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "starcaster_readonly_select" ON "public"."x_harvest_runs" FOR SELECT TO "starcaster_readonly" USING (true);

--
-- Name: theme_wizard_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."theme_wizard_candidates" ENABLE ROW LEVEL SECURITY;

--
-- Name: theme_wizard_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."theme_wizard_jobs" ENABLE ROW LEVEL SECURITY;

--
-- Name: theme_wizard_library_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."theme_wizard_library_entries" ENABLE ROW LEVEL SECURITY;

--
-- Name: theme_wizard_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."theme_wizard_sessions" ENABLE ROW LEVEL SECURITY;

--
-- Name: training_corpus; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."training_corpus" ENABLE ROW LEVEL SECURITY;

--
-- Name: training_rules_guides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."training_rules_guides" ENABLE ROW LEVEL SECURITY;

--
-- Name: training_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."training_settings" ENABLE ROW LEVEL SECURITY;

--
-- Name: training_taxonomy; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."training_taxonomy" ENABLE ROW LEVEL SECURITY;

--
-- Name: website_peers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."website_peers" ENABLE ROW LEVEL SECURITY;

--
-- Name: x_harvest_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."x_harvest_runs" ENABLE ROW LEVEL SECURITY;

--
-- Name: youtube_comment_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."youtube_comment_runs" ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--
