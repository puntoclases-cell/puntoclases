BEGIN;

-- Rate limiting genérico por clave (endpoint:tipo:valor), ventana fija.
-- El chequeo es atómico bajo concurrencia: el UNIQUE en `clave` serializa
-- los INSERT/UPDATE concurrentes de la misma clave (upsert-as-counter).
CREATE TABLE IF NOT EXISTS rate_limits (
  clave text PRIMARY KEY,
  contador integer NOT NULL DEFAULT 1,
  ventana_inicio timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
-- Sin policies = deny-all para anon/authenticated. Solo se toca vía la
-- función de abajo, llamada por el rol postgres (DATABASE_URL), que bypasea RLS.

CREATE OR REPLACE FUNCTION chequear_rate_limit(p_clave text, p_limite integer, p_ventana_seg integer)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_contador integer;
BEGIN
  INSERT INTO rate_limits (clave, contador, ventana_inicio)
  VALUES (p_clave, 1, now())
  ON CONFLICT (clave) DO UPDATE
    SET contador = CASE
          WHEN rate_limits.ventana_inicio < now() - make_interval(secs => p_ventana_seg)
            THEN 1
          ELSE rate_limits.contador + 1
        END,
        ventana_inicio = CASE
          WHEN rate_limits.ventana_inicio < now() - make_interval(secs => p_ventana_seg)
            THEN now()
          ELSE rate_limits.ventana_inicio
        END
  RETURNING contador INTO v_contador;

  RETURN v_contador <= p_limite;
END;
$$;

REVOKE EXECUTE ON FUNCTION chequear_rate_limit(text, integer, integer) FROM PUBLIC;

COMMIT;
