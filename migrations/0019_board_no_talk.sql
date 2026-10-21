-- 이야기 leaves the board's categories (contracts/board CATEGORIES): its posts stay, filed as 질문.
UPDATE posts SET category = 'question' WHERE category = 'talk';
