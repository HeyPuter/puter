find ./ -type f ! -path "*.png" ! -path "*.jpg" ! -path "*.css" ! -path "*.js" ! -path "./.DS_Store" ! -path "*.DS_Store" ! -path "*.jpeg" ! -path "*.webp" ! -path "./lib/socket.io/*" ! -path "./lib/path.js" -print0 | while IFS= read -r -d $'\0' file; do 
    echo "FILE: $file\n" >> dump.txt; 
    cat "$file" >> dump.txt; 
    echo -e "\n------------------------------------------------------------------------\n" >> dump.txt;
    echo -e "------------------------------------------------------------------------\n" >> dump.txt;
done
