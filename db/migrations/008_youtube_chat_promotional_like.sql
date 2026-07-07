ALTER TABLE youtube_chat_messages
  DROP CONSTRAINT IF EXISTS youtube_chat_messages_message_kind_check;

ALTER TABLE youtube_chat_messages
  ADD CONSTRAINT youtube_chat_messages_message_kind_check
  CHECK (message_kind IN ('new_event', 'manual_test', 'promotional_like'));
