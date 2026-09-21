-- Tabla para almacenar tokens FCM de push notifications
CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  plataforma TEXT NOT NULL DEFAULT 'android',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Un usuario puede tener múltiples tokens (varios dispositivos)
CREATE INDEX IF NOT EXISTS idx_push_tokens_usuario ON push_tokens(id_usuario);

-- Eliminar tokens duplicados (mismo usuario, mismo token)
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_unique ON push_tokens(id_usuario, token);

-- RLS: solo el usuario puede ver/modificar sus tokens
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios ven sus propios tokens"
  ON push_tokens FOR SELECT
  USING (auth.uid() = id_usuario);

CREATE POLICY "Usuarios insertan sus tokens"
  ON push_tokens FOR INSERT
  WITH CHECK (auth.uid() = id_usuario);

CREATE POLICY "Usuarios actualizan sus tokens"
  ON push_tokens FOR UPDATE
  USING (auth.uid() = id_usuario);

CREATE POLICY "Usuarios eliminan sus tokens"
  ON push_tokens FOR DELETE
  USING (auth.uid() = id_usuario);

-- Función para limpiar tokens antiguos (más de 30 días)
CREATE OR REPLACE FUNCTION limpiar_tokens_antiguos()
RETURNS void AS $$
BEGIN
  DELETE FROM push_tokens
  WHERE created_at < now() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Permisos para la Edge Function (acceso Admin)
GRANT ALL ON push_tokens TO service_role;
