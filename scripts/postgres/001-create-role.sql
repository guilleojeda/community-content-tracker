DO
$$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'contentuser'
  ) THEN
    CREATE ROLE contentuser WITH LOGIN PASSWORD 'your-secure-password';
  END IF;
END;
$$;
