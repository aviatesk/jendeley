import {Command} from 'commander'
import {startServer} from './server'
import {genDB} from './gen'


async function main() {
    const program = new Command();

    program.name("jendeley");

    program
        .command('gen')
        .requiredOption('--papers_dir <dir>', "Root directory of your papers")
        .option('--book_dirs <dirs>', "Comma separated directories of books")
        .option('--output <out>', "Output DB to this file. By default, <papers_dir>/db.json.")
        .action((cmd, options) => {
            const book_dirs_str = options._optionValues.book_dirs == undefined ? "" : options._optionValues.book_dirs;
            genDB(options._optionValues.papers_dir, book_dirs_str, options._optionValues.output);
        });

    program
        .command('server')
        .requiredOption('--db <db>', "DB file generated by gen command")
        .action((cmd, options) => {
            startServer(options._optionValues.db);
        });


    program.parse();
}

main().then(
    _arg => {
    }
);
