-- 学习状态与版本条件写入；不修改原面试计划、成绩或历史补题。
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS study_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS study_revision bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.study_compare_and_set(
  p_session_id text, p_revision bigint, p_state jsonb,
  p_drills jsonb DEFAULT '[]'::jsonb, p_practice jsonb DEFAULT '{}'::jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE changed integer;
BEGIN
  UPDATE public.sessions s SET
    study_state = p_state,
    study_revision = s.study_revision + 1,
    drill_items = (
      SELECT COALESCE(jsonb_agg(item ORDER BY item->>'id'), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON (item->>'id') item
        FROM jsonb_array_elements(COALESCE(s.drill_items, '[]'::jsonb) || p_drills)
          WITH ORDINALITY AS d(item, n)
        ORDER BY item->>'id', n DESC
      ) merged
    ),
    practice_state = COALESCE(s.practice_state, '{}'::jsonb) || p_practice
  WHERE s.id = p_session_id AND s.study_revision = p_revision;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.study_compare_and_set(text, bigint, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.study_compare_and_set(text, bigint, jsonb, jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.study_compare_and_set(text, bigint, jsonb, jsonb, jsonb) TO service_role;
