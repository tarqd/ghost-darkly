CREATE USER 'repl'@'*' IDENTIFIED BY 'repl';

GRANT ALTER,
      CREATE,
      DELETE,
      DROP, 
      INDEX, 
      INSERT, 
      LOCK TABLES, 
      SELECT, 
      TRIGGER, 
      UPDATE,
      SUPER,
      REPLICATION SLAVE
    ON *.*
    TO 'repl'@'*';

      
FLUSH PRIVILEGES;

