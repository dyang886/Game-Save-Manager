import json
import logging
import os
import sqlite3
import sys
from datetime import datetime, timedelta

import gevent.timeout
import requests
import gevent
from steam.client import SteamClient
import mwparserfromhell

WIKI_API_URL = "https://www.pcgamingwiki.com/w/api.php"
RELEVANT_CATEGORIES = ["Category:Games", "Category:Emulators"]
game_processed = 0

open('./database/database_fetcher.log', 'w').close()
logging.basicConfig(
    filename='./database/database_fetcher.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    encoding='utf-8'
)


class DatabaseFetcher:
    def __init__(self):
        self.conn = sqlite3.connect('./database/database.db')
        self.create_tables()
        self.client = requests.Session()
    
    def fetch_all_category_members(self):
        for category in RELEVANT_CATEGORIES:
            continue_param = {}

            while True:
                members = []
                params = {
                    "action": "query",
                    "list": "categorymembers",
                    "cmtitle": category,
                    "cmlimit": "50",
                    "format": "json"
                }
                if continue_param:
                    params.update(continue_param)
                
                # Query game entries
                retry = 0
                max_retry = 10
                while retry < max_retry:
                    try:
                        response = self.client.get(WIKI_API_URL, params=params).json()
                        members.extend(response.get("query", {}).get("categorymembers", []))
                        break
                    except Exception as e:
                        retry += 1
                        logging.warning(f"Failed to query game entries (attempt {retry}/{max_retry}): {str(e)}")
                        if retry >= max_retry:
                            raise

                self.process_games(members)
                
                if "continue" in response:
                    continue_param = response["continue"]
                    logging.info("Continue parameter: %s", continue_param)
                else:
                    logging.info(f"All entries fetched for {category}!")
                    break

    def process_games(self, entry_members):
        global game_processed
        steam_ids = []
        try:
            for member in entry_members:
                title = member["title"]
                wiki_page_id = member["pageid"]
                game_entry = {
                    'title': title,
                    'wiki_page_id': wiki_page_id,
                    'install_folder': None
                }

                # Process wikitext
                retry = 0
                max_retry = 10
                while retry < max_retry:
                    try:
                        wikitext = self.fetch_wikitext(wiki_page_id)
                        parsed_entry = self.parse_wikitext(wikitext)
                        game_entry.update(parsed_entry)
                        break
                    except Exception as e:
                        retry += 1
                        logging.warning(f"Failed to process wikitext for {title} (attempt {retry}/{max_retry}): {str(e)}")
                        if retry >= max_retry:
                            raise

                if not any(save_paths for save_paths in game_entry['save_location'].values()):
                    logging.info(f"No save locations found: {title}")
                    continue
                if game_entry['steam_id']:
                    steam_ids.append(int(game_entry['steam_id']))
                self.save_entry(game_entry)

                game_processed += 1
                logging.info(f"{game_processed}. Saved in database: {title}")
            
            logging.info("Finding game installation folders...")

            # Process steam database
            retry = 0
            max_retry = 10
            while retry < max_retry:
                try:
                    self.find_install_folder_name(steam_ids)
                    break
                except (gevent.timeout.Timeout, Exception) as e:
                    retry += 1
                    logging.warning(f"Failed to fetch steam database (attempt {retry}/{max_retry}): {str(e)}")
                    if retry >= max_retry:
                        raise

        except (gevent.timeout.Timeout, Exception) as e:
            logging.error(f"Error processing game entry for {title}: {str(e)}", exc_info=True)

    def fetch_wikitext(self, page_id):
        params = {
            "action": "parse",
            "pageid": page_id,
            "prop": "wikitext",
            "format": "json",
            "redirects": "1"
        }
        response = self.client.get(WIKI_API_URL, params=params).json()
        return response.get("parse", {}).get("wikitext", {}).get("*", "")

    def parse_wikitext(self, wikitext):
        entry = {
            'steam_id': None,
            'gog_id': None,
            'save_location': {'win': set(), 'reg': set(), 'mac': set(), 'linux': set()},
            'platform': set()
        }
        system_map = {
            'Registry': 'reg',
            'Windows': 'win',
            'Microsoft Store': 'win',
            'Steam': 'win',
            'GOG.com': 'win',
            'Ubisoft Connect': 'win',
            'Uplay': 'win',
            'Origin': 'win',
            'Epic Games Store': 'win',
            'Epic Games Launcher': 'win',
            'Amazon Games': 'win',
            'DOS': 'win',
            'PC booter': 'win',
            'OS X': 'mac',
            'Mac OS': 'mac',
            'Mac App Store': 'mac',
            'Linux': 'linux'
        }
        platform_map = {
            'steam': 'Steam',
            'steam-sub': 'Steam',
            'microsoft store': 'Xbox',
            'ms store': 'Xbox',
            'gog': 'GOG',
            'gog.com': 'GOG',
            'ubisoft store': 'Ubisoft',
            'ubisoft': 'Ubisoft',
            'uplay': 'Ubisoft',
            'origin': 'EA',
            'ea desktop': 'EA',
            'epic games store': 'Epic',
            'epic': 'Epic',
            'egs': 'Epic',
            'battle.net': 'Blizzard',

            # Below are ignored platform
            'official': '',
            'offical': '',
            'retail': '',
            'publisher': '',
            'developer': '',
            'amazon.co.uk': '',
            'bethesda.net': '',
            'zoom': '',
            'zoom platform': '',
            'macapp': '',
            'mac app store': '',
            'oculus': '',
            'oculus store': '',
            'amazon': '',
            'amazon.com': '',
            'gmg': '',
            'humble': '',
            'humble store': '',
            'itch.io': '',
            'gamesplanet': '',
            'gamersgate': '',
            'viveport': '',
            'games for windows marketplace': '',
            'discord': '',
            'twitch': ''
        }

        wikicode = mwparserfromhell.parse(wikitext)

        # Extract steam id and gog id
        infobox_templates = wikicode.filter_templates(matches=lambda x: x.name.strip() == 'Infobox game')
        if infobox_templates:
            infobox = infobox_templates[0]
            if infobox.has('steam appid'):
                entry['steam_id'] = infobox.get('steam appid').value.strip()
            if infobox.has('gogcom id'):
                entry['gog_id'] = infobox.get('gogcom id').value.strip()
        
        # Extract available platforms
        availability_templates = wikicode.filter_templates(matches=lambda x: x.name.strip() == 'Availability/row')
        for template in availability_templates:
            raw_platform = template.params[0].strip()
            platform = platform_map.get(raw_platform.lower().replace("1=", "").strip(), "unknown")
            if platform and platform != "unknown":
                entry['platform'].add(platform)
            elif platform == "unknown":
                logging.warning(f"Unknown platform: {raw_platform}")

        # Extract save locations
        for template_name in ['Game data/config', 'Game data/saves']:
            templates = wikicode.filter_templates(matches=lambda x: x.name.strip() == template_name)
            for template in templates:
                # example of a "template": {{Game data/saves|Windows|{{p|game}}\mlc01\usr\save\|{{p|userprofile}}\Documents\mlc01\usr\save\{{Note|Legacy default location}}}}
                params = template.params
                system = params[0].strip()
                paths = params[1:]

                if system in system_map and any(path.strip() for path in paths):
                    for path in paths:
                        cleaned_path_nodes = []

                        for node in path.value.nodes:
                            if isinstance(node, mwparserfromhell.nodes.template.Template):
                                # Remove the "Note" and "citation needed" section, for instance: {{Note|Legacy default location}} or {{cn}}
                                if node.name.lower().strip() in ["note", "cn"]:
                                    continue
                                if len(node.params) > 0 and node.params[0].lower().strip() in ["hkcu", "hkey_current_user", "hklm", "hkey_local_machine", "wow64"]:
                                    system = "Registry"
                            elif any(key in str(node).lower().strip() for key in ["hkey_current_user", "hkey_local_machine"]):
                                system = "Registry"

                            node_str = str(node).strip()
                            if '<ref>' in node_str and '</ref>' in node_str:
                                node = node_str.split('<ref>')[0] + node_str.split('</ref>')[1]
                            if '<!--' in node_str and '-->' in node_str:
                                node = node_str.split('<!--')[0] + node_str.split('-->')[1]

                            cleaned_path_nodes.append(str(node))
                        cleaned_path = "".join(cleaned_path_nodes).strip()

                        # Only keep the most general path, any subdirectories should not be separate paths
                        if cleaned_path:
                            save_location_key = system_map[system]
                            relative_paths = {p for p in entry['save_location'][save_location_key] if not os.path.isabs(p)}
                            absolute_paths = {p for p in entry['save_location'][save_location_key] if os.path.isabs(p)}

                            is_abs = os.path.isabs(cleaned_path)
                            should_add_path = True
                            cleaned_path_normalized = os.path.normpath(cleaned_path)
                            
                            paths_to_check = absolute_paths if is_abs else relative_paths
                            try:
                                for existing_path in paths_to_check:
                                    existing_path_normalized = os.path.normpath(existing_path)
                                    common_path = os.path.commonpath([existing_path_normalized, cleaned_path_normalized])

                                    if common_path == existing_path_normalized:
                                        should_add_path = False
                                        break
                                    if common_path == cleaned_path_normalized:
                                        entry['save_location'][save_location_key].remove(existing_path)

                            except ValueError as e:
                                if not str(e) == "Paths don't have the same drive":
                                    raise e

                            if should_add_path:
                                entry['save_location'][save_location_key].add(cleaned_path_normalized)

                if system not in system_map:
                    logging.warning(f"Unknown system: {system}")
        
        for os_key in entry['save_location']:
            entry['save_location'][os_key] = list(entry['save_location'][os_key])
        entry['platform'] = list(entry['platform'])

        return entry
    
    def find_install_folder_name(self, steam_ids):
        if steam_ids:
            client = SteamClient()
            client.anonymous_login()
            info = client.get_product_info(apps=steam_ids)

            apps_info = info.get('apps', {})
            for steam_id, app_data in apps_info.items():
                install_folder_name = app_data.get('config', {}).get('installdir', None)

                # Update "install_folder" in database
                if install_folder_name:
                    entry = self.find_entry_by_key("steam_id", steam_id)
                    if entry:
                        entry['install_folder'] = install_folder_name
                        self.save_entry(entry)
                        logging.info(f"Found installation folder for steam_id {steam_id}")
                    else:
                        logging.error(f"No entry found in database for steam_id {steam_id}")

    def fetch_recent_changes(self):
        last_recent_change_time = self.get_last_recent_change_time()
        start = last_recent_change_time - timedelta(minutes=1)
        end = datetime.now()
        logging.info(f"Fetching recent changes from {start} to {end}")

        recent_changes = []
        params = {
            "action": "query",
            "list": "recentchanges",
            "rcdir": "newer",
            "rcstart": start.isoformat() + "Z",
            "rcend": end.isoformat() + "Z",
            "rclimit": "500",
            "rcnamespace": "0",
            "format": "json"
        }

        retry = 0
        max_retry = 10
        while retry < max_retry:
            try:
                response = self.client.get(WIKI_API_URL, params=params).json()
                recent_changes.extend(response.get("query", {}).get("recentchanges", []))
                break
            except Exception as e:
                retry += 1
                logging.warning(f"Failed to query recent changes (attempt {retry}/{max_retry}): {str(e)}")
                if retry >= max_retry:
                    raise

        members = []
        distinct_page_ids = set()
        for change in recent_changes:
            page_id = change.get("pageid")
            title = change.get("title")
            
            if page_id not in distinct_page_ids:
                members.append({"title": title, "pageid": page_id})
                distinct_page_ids.add(page_id)
        
        self.process_games(members)
        self.update_last_recent_change_time(end)
        logging.info("All recent changes fetched!")

    def get_last_recent_change_time(self):
        cursor = self.conn.cursor()
        cursor.execute("SELECT value FROM metadata WHERE key='last_recent_change_time'")
        row = cursor.fetchone()
        cursor.close()
        if row:
            return datetime.fromisoformat(row[0])
        else:
            return datetime.now() - timedelta(days=1)

    def update_last_recent_change_time(self, timestamp):
        with self.conn:
            self.conn.execute("""
                INSERT OR REPLACE INTO metadata (key, value)
                VALUES ('last_recent_change_time', ?)
            """, (timestamp.isoformat(),))

    def create_tables(self):
        with self.conn:
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS games (
                    title TEXT PRIMARY KEY,
                    wiki_page_id INTEGER,
                    install_folder TEXT,
                    steam_id INTEGER,
                    gog_id INTEGER,
                    save_location TEXT,
                    platform TEXT
                )
            """)
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            """)

    def save_entry(self, entry):
        with self.conn:
            self.conn.execute("""
                INSERT OR REPLACE INTO games
                (title, wiki_page_id, install_folder, steam_id, gog_id, save_location, platform)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                entry['title'],
                entry['wiki_page_id'],
                entry['install_folder'],
                entry.get('steam_id'),
                entry.get('gog_id'),
                json.dumps(entry.get('save_location')),
                json.dumps(entry.get('platform'))
            ))
    
    def find_entry_by_key(self, type, value):
        cursor = self.conn.cursor()
        cursor.execute(f"SELECT * FROM games WHERE {type} = ?", (value,))
        row = cursor.fetchone()
        cursor.close()
        if row:
            return {
                'title': row[0],
                'wiki_page_id': row[1],
                'install_folder': row[2],
                'steam_id': row[3],
                'gog_id': row[4],
                'save_location': json.loads(row[5]) if row[5] else None,
                'platform': json.loads(row[6]) if row[6] else None
            }
        return None

def main():
    '''
    System argument: empty argument defaults to fetch all entries; "recent" for fetching recent changes
    '''
    fetcher = DatabaseFetcher()
    if len(sys.argv) > 1 and sys.argv[1] == 'recent':
        fetcher.fetch_recent_changes()
    else:
        fetcher.fetch_all_category_members()

if __name__ == "__main__":
    main()
