-- Enable godmode for dev-center app to allow launching editor with file_paths
-- This fixes issue #2218 where worker files couldn't be opened from DEV Center

UPDATE `apps` SET `godmode`=1 WHERE `uid`='app-0b37f054-07d4-4627-8765-11bd23e889d4';
