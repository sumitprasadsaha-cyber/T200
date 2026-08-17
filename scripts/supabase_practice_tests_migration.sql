-- ====================================================================
-- SUPABASE MIGRATION: PRACTICE TEST MODULE
-- Table: public.topic_assessment_questions
-- ====================================================================

-- 1. Create the topic_assessment_questions table
CREATE TABLE IF NOT EXISTS public.topic_assessment_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    question_type TEXT NOT NULL DEFAULT 'MCQ', -- 'MCQ' or 'TRUE_FALSE'
    question TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    correct_answer TEXT NOT NULL,
    published BOOLEAN NOT NULL DEFAULT TRUE,
    order_index INT NOT NULL DEFAULT 0,
    raw_text TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create indices for performance when querying by Class, Subject, Chapter, Topic
CREATE INDEX IF NOT EXISTS idx_topic_assessment_lookup 
ON public.topic_assessment_questions (class_id, subject_id, chapter_id, topic_id);

CREATE INDEX IF NOT EXISTS idx_topic_assessment_chapter 
ON public.topic_assessment_questions (class_id, subject_id, chapter_id);

CREATE INDEX IF NOT EXISTS idx_topic_assessment_published 
ON public.topic_assessment_questions (published);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.topic_assessment_questions ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "Allow public read access to published questions" ON public.topic_assessment_questions;
DROP POLICY IF EXISTS "Allow public write access to practice test questions" ON public.topic_assessment_questions;
DROP POLICY IF EXISTS "Allow public update access to practice test questions" ON public.topic_assessment_questions;
DROP POLICY IF EXISTS "Allow public delete access to practice test questions" ON public.topic_assessment_questions;

-- Select policy: Allow reading published questions (or all for admin)
CREATE POLICY "Allow public read access to published questions"
ON public.topic_assessment_questions
FOR SELECT
USING (true);

-- Insert policy: Allow inserting practice test questions
CREATE POLICY "Allow public write access to practice test questions"
ON public.topic_assessment_questions
FOR INSERT
WITH CHECK (true);

-- Update policy: Allow updating practice test questions
CREATE POLICY "Allow public update access to practice test questions"
ON public.topic_assessment_questions
FOR UPDATE
USING (true)
WITH CHECK (true);

-- Delete policy: Allow deleting practice test questions
CREATE POLICY "Allow public delete access to practice test questions"
ON public.topic_assessment_questions
FOR DELETE
USING (true);

-- 5. Notify PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
